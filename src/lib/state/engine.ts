/**
 * The state engine.
 *
 * Pure, deterministic, and fully traceable: given the same inputs it produces
 * the same state, and every number carries the factors that produced it. The
 * LLM never decides what the bottleneck is — it explains the one computed here.
 *
 * That split is the reason a recommendation can be audited. If a recommendation
 * is wrong, the fix is a weight or a formula in this file, not prompt wording.
 */

import type {
  Bottleneck,
  Entity,
  MomentumReading,
  Opportunity,
  Project,
  RiskLevel,
  ScoredCandidate,
  StateSignals,
  Task,
  TrajectoryDirection,
  TrajectoryEvent,
  WaitingItem,
} from "@/lib/types";

// --- tuning constants ------------------------------------------------------

/**
 * Event weights. A merged PR is real progress; a comment is a signal of life.
 * These encode judgement about what "movement" means and are the first thing to
 * tune if momentum readings feel wrong.
 */
const EVENT_WEIGHTS: Record<string, number> = {
  "github.pr_merged": 3,
  "github.pr_opened": 1.5,
  "github.issue_closed": 1.5,
  "github.issue_opened": 0.8,
  "github.commit": 1,
  "email.sent": 1.2,
  "email.received": 0.8,
  "notion.page_updated": 1,
  "calendar.event_created": 0.8,
  "calendar.event_cancelled": -1,
  "task.completed": 2.5,
  "deal.stage_advanced": 4,
  "proposal.sent": 3,
};
const DEFAULT_EVENT_WEIGHT = 0.5;

/** Decay constant: an event's contribution halves roughly every 7 days. */
const MOMENTUM_LAMBDA = Math.LN2 / 7;

/** Trailing window for momentum, and the comparison window before it. */
const MOMENTUM_WINDOW_DAYS = 14;

const MS_PER_DAY = 864e5;

const daysBetween = (a: string | number, b: number = Date.now()) =>
  (b - new Date(a).getTime()) / MS_PER_DAY;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// --- project momentum ------------------------------------------------------

function decayedScore(events: TrajectoryEvent[], relativeTo = Date.now()): number {
  return events.reduce((sum, e) => {
    const weight = EVENT_WEIGHTS[e.type] ?? DEFAULT_EVENT_WEIGHT;
    const age = Math.max(0, daysBetween(e.occurredAt, relativeTo));
    return sum + weight * Math.exp(-MOMENTUM_LAMBDA * age);
  }, 0);
}

export function computeProjectMomentum(
  projects: Project[],
  events: TrajectoryEvent[],
): MomentumReading[] {
  const nowMs = Date.now();
  const windowStart = nowMs - MOMENTUM_WINDOW_DAYS * MS_PER_DAY;
  const priorStart = nowMs - 2 * MOMENTUM_WINDOW_DAYS * MS_PER_DAY;

  return projects
    .filter((p) => p.status === "active")
    .map((project) => {
      const projectEvents = events.filter((e) => e.projectId === project.id);
      const current = projectEvents.filter(
        (e) => new Date(e.occurredAt).getTime() >= windowStart,
      );
      const prior = projectEvents.filter((e) => {
        const t = new Date(e.occurredAt).getTime();
        return t >= priorStart && t < windowStart;
      });

      const score = decayedScore(current);
      // Score the prior window as of its own end, so the two are comparable.
      const priorScore = decayedScore(prior, windowStart);
      const delta = score - priorScore;

      const lastEventAt = projectEvents
        .map((e) => e.occurredAt)
        .sort()
        .pop();
      const daysSinceLast = lastEventAt ? daysBetween(lastEventAt) : Infinity;

      let status: MomentumReading["status"];
      if (daysSinceLast > 14) status = "stalled";
      else if (score >= 4 && delta >= 0) status = "hot";
      else if (delta < -1) status = "cooling";
      else status = "steady";

      return {
        projectId: project.id,
        projectName: project.name,
        score: round(score),
        delta: round(delta),
        eventsInWindow: current.length,
        lastEventAt,
        status,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// --- commercial momentum ---------------------------------------------------

/**
 * Value-weighted pipeline health, normalised to 0..1.
 *
 * Positive: expected value in flight, weighted by stage progression.
 * Negative: opportunities that have gone quiet past their expected reply window
 * — silence on a deal is not neutral, it is decay.
 */
const STAGE_WEIGHT: Record<string, number> = {
  discovery: 0.3,
  qualified: 0.5,
  proposal: 0.7,
  negotiation: 0.9,
  closed_won: 1,
  closed_lost: 0,
};

export function computeCommercialMomentum(opportunities: Opportunity[]): {
  score: number;
  delta: number;
  stale: Opportunity[];
} {
  const live = opportunities.filter(
    (o) => o.stage !== "closed_won" && o.stage !== "closed_lost",
  );
  if (!live.length) return { score: 0, delta: 0, stale: [] };

  const totalValue = live.reduce((s, o) => s + o.value, 0) || 1;
  const stale: Opportunity[] = [];

  let weighted = 0;
  for (const opp of live) {
    const stageWeight = STAGE_WEIGHT[opp.stage] ?? 0.4;
    const share = opp.value / totalValue;

    // Silence penalty ramps from 0 at the expected reply window to 1 at 3x it.
    let silence = 0;
    if (opp.lastContactAt) {
      const quiet = daysBetween(opp.lastContactAt);
      const overdue = quiet - opp.expectedReplyDays;
      if (overdue > 0) {
        silence = clamp01(overdue / (opp.expectedReplyDays * 2));
        stale.push(opp);
      }
    }

    weighted += share * stageWeight * opp.probability * (1 - silence);
  }

  // Normalise: a healthy pipeline scores around 0.5, an excellent one near 1.
  const score = clamp01(weighted * 2);
  const delta = -stale.reduce((s, o) => s + o.value / totalValue, 0) * 0.5;

  return { score: round(score), delta: round(delta), stale };
}

// --- bottleneck ------------------------------------------------------------

/**
 * Walk the blocking graph and sum the value of everything downstream of `taskId`.
 *
 * This is why the bottleneck is often not the most urgent item: it is the item
 * with the most value dammed up behind it per hour of effort to clear.
 */
function downstreamValue(
  taskId: string,
  tasks: Task[],
  projects: Project[],
  seen = new Set<string>(),
): { value: number; blocked: string[] } {
  if (seen.has(taskId)) return { value: 0, blocked: [] };
  seen.add(taskId);

  const direct = tasks.filter((t) => t.blockedBy.includes(taskId));
  let value = 0;
  const blocked: string[] = [];

  for (const t of direct) {
    const project = projects.find((p) => p.id === t.projectId);
    const projectValue = project?.valueScore ?? 0.5;
    value += t.impact * projectValue;
    blocked.push(t.title);

    const deeper = downstreamValue(t.id, tasks, projects, seen);
    // Transitive value is discounted — two hops away is real but weaker.
    value += deeper.value * 0.6;
    blocked.push(...deeper.blocked);
  }

  return { value, blocked };
}

export function computeBottleneck(
  tasks: Task[],
  projects: Project[],
): Bottleneck | undefined {
  const candidates = tasks.filter(
    (t) => t.status !== "done" && !t.blockedBy.length,
  );

  const scored = candidates
    .map((task) => {
      const { value, blocked } = downstreamValue(task.id, tasks, projects);
      if (!blocked.length) return null;

      const project = projects.find((p) => p.id === task.projectId);
      const ownValue = task.impact * (project?.valueScore ?? 0.5);
      const total = value + ownValue;

      // Age pressure: how long has this been sitting, or how close is its due date.
      const ageDays = task.dueAt
        ? Math.max(0, -daysBetween(task.dueAt))
        : 0;
      const urgency = task.dueAt
        ? 1 + clamp01((7 - daysBetween(Date.now(), new Date(task.dueAt).getTime())) / 7)
        : 1;

      const blockingScore = (total * urgency * (1 + blocked.length * 0.2)) /
        Math.max(0.5, task.effortHours);

      return {
        id: task.id,
        kind: "task" as const,
        title: task.title,
        blockingScore: round(blockingScore),
        downstreamValue: round(total),
        ageDays: round(ageDays),
        dependencyCount: blocked.length,
        effortHours: task.effortHours,
        blockedItems: [...new Set(blocked)],
      };
    })
    .filter((b) => b !== null)
    .sort((a, b) => b.blockingScore - a.blockingScore);

  return scored[0] ?? undefined;
}

// --- leverage --------------------------------------------------------------

/**
 * Urgency from deadline proximity: 0.3 with no deadline, rising to 1 at the
 * due date and beyond.
 */
function deadlineUrgency(dueAt?: string): number {
  if (!dueAt) return 0.3;
  const daysUntil = -daysBetween(dueAt);
  if (daysUntil <= 0) return 1;
  return clamp01(1 - daysUntil / 14);
}

/**
 * Urgency from where a counterparty sits in their own buying cycle. This is the
 * signal that makes "before noon" a real claim rather than a flourish.
 */
function buyingCycleUrgency(opp: Opportunity, entities: Entity[]): {
  urgency: number;
  reason: string;
} {
  if (!opp.lastContactAt) return { urgency: 0.4, reason: "no recorded contact" };

  const quiet = daysBetween(opp.lastContactAt);
  const company = entities.find((e) => e.id === opp.companyId);
  const cycleDays = Number(company?.attributes?.buyingCycleDays ?? 0);

  if (cycleDays > 0) {
    // Peak urgency at ~60% through the cycle: late enough to matter, early
    // enough to still influence the decision.
    const position = quiet / cycleDays;
    const urgency = clamp01(position / 0.6);
    return {
      urgency,
      reason: `day ${Math.round(quiet)} of ${cycleDays}-day buying cycle at ${company?.name}`,
    };
  }

  const overdue = quiet - opp.expectedReplyDays;
  return {
    urgency: clamp01(overdue / opp.expectedReplyDays),
    reason:
      overdue > 0
        ? `${Math.round(overdue)}d past expected reply window`
        : "within expected reply window",
  };
}

export function computeCandidates(
  tasks: Task[],
  projects: Project[],
  opportunities: Opportunity[],
  entities: Entity[],
  bottleneck?: Bottleneck,
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];

  // 1. Unblocked, unfinished tasks.
  for (const task of tasks) {
    if (task.status === "done" || task.status === "waiting") continue;
    if (task.blockedBy.some((id) => tasks.find((t) => t.id === id)?.status !== "done"))
      continue;

    const project = projects.find((p) => p.id === task.projectId);
    const impact = task.impact * (project?.valueScore ?? 0.5);
    const urgency = deadlineUrgency(task.dueAt);

    // Clearing the bottleneck earns a multiplier scaled by the value it
    // releases, not merely the count of items — unblocking three trivial tasks
    // is not the same as unblocking a contract.
    const isBottleneck = bottleneck?.id === task.id;
    const unblockFactor = isBottleneck
      ? 1 + bottleneck.downstreamValue * 0.5 + bottleneck.dependencyCount * 0.3
      : 1;

    const leverage = (impact * urgency * unblockFactor) / Math.max(0.25, task.effortHours);

    const factors = [
      `impact ${impact.toFixed(2)} (task ${task.impact} x project value ${(project?.valueScore ?? 0.5).toFixed(2)})`,
      `urgency ${urgency.toFixed(2)}${task.dueAt ? ` (due ${new Date(task.dueAt).toLocaleDateString("en-GB")})` : " (no deadline)"}`,
      `effort ${task.effortHours}h`,
    ];
    if (isBottleneck) {
      factors.push(`unblocks ${bottleneck.dependencyCount} downstream item(s)`);
    }

    candidates.push({
      id: task.id,
      kind: isBottleneck ? "unblock" : "task",
      title: task.title,
      leverage: round(leverage),
      impact: round(impact),
      urgency: round(urgency),
      unblockFactor: round(unblockFactor),
      effortHours: task.effortHours,
      factors,
      projectId: task.projectId,
    });
  }

  // 2. Opportunities needing a touch.
  const totalPipeline = opportunities.reduce((s, o) => s + o.value, 0) || 1;
  for (const opp of opportunities) {
    if (opp.stage === "closed_won" || opp.stage === "closed_lost") continue;

    const { urgency, reason } = buyingCycleUrgency(opp, entities);
    if (urgency < 0.2) continue;

    const impact = (opp.value / totalPipeline) * opp.probability +
      (STAGE_WEIGHT[opp.stage] ?? 0.4) * 0.3;
    const effortHours = 0.5;
    const leverage = (impact * urgency) / effortHours;

    candidates.push({
      id: opp.id,
      kind: "opportunity",
      title: opp.nextStep ?? `Advance ${opp.name}`,
      leverage: round(leverage),
      impact: round(impact),
      urgency: round(urgency),
      unblockFactor: 1,
      effortHours,
      factors: [
        `${opp.currency} ${opp.value.toLocaleString()} at ${Math.round(opp.probability * 100)}% — stage ${opp.stage}`,
        reason,
        `effort ${effortHours}h`,
      ],
    });
  }

  return candidates.sort((a, b) => b.leverage - a.leverage);
}

// --- risk & direction ------------------------------------------------------

export function computeWaiting(tasks: Task[], entities: Entity[]): WaitingItem[] {
  return tasks
    .filter((t) => t.status === "waiting" && t.waitingSince)
    .map((t) => {
      const days = daysBetween(t.waitingSince!);
      const who = entities.find((e) => e.id === t.waitingOn);
      return {
        id: t.id,
        title: t.title,
        waitingOn: who?.name ?? "unknown",
        daysWaiting: Math.round(days),
        overdue: days > 5,
      };
    })
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
}

export function computeRisk(signals: {
  overdueCount: number;
  staleOpportunities: Opportunity[];
  waiting: WaitingItem[];
  blocked: Task[];
  commercialMomentum: number;
  bottleneck?: Bottleneck;
}): { level: RiskLevel; score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  if (signals.overdueCount > 0) {
    score += Math.min(3, signals.overdueCount);
    factors.push(`${signals.overdueCount} overdue commitment(s)`);
  }

  const staleValue = signals.staleOpportunities.reduce((s, o) => s + o.value, 0);
  if (staleValue > 0) {
    score += Math.min(3, staleValue / 50000);
    factors.push(
      `£${Math.round(staleValue / 1000)}k of pipeline past its reply window`,
    );
  }

  const overdueWaits = signals.waiting.filter((w) => w.overdue);
  if (overdueWaits.length) {
    score += overdueWaits.length * 0.8;
    factors.push(`${overdueWaits.length} item(s) waiting beyond 5 days`);
  }

  if (signals.blocked.length >= 3) {
    score += 1.5;
    factors.push(`${signals.blocked.length} tasks blocked`);
  }

  if (signals.commercialMomentum < 0.3) {
    score += 1.5;
    factors.push("commercial momentum below healthy threshold");
  }

  if (signals.bottleneck && signals.bottleneck.dependencyCount >= 3) {
    score += 1;
    factors.push(
      `single bottleneck holding ${signals.bottleneck.dependencyCount} items`,
    );
  }

  let level: RiskLevel = "low";
  if (score >= 7) level = "critical";
  else if (score >= 4.5) level = "high";
  else if (score >= 2) level = "elevated";

  return { level, score: round(score), factors };
}

export function computeDirection(
  momentum: MomentumReading[],
  commercialDelta: number,
  risk: RiskLevel,
): TrajectoryDirection {
  const totalDelta =
    momentum.reduce((s, m) => s + m.delta, 0) + commercialDelta * 3;
  const stalled = momentum.filter((m) => m.status === "stalled").length;
  const active = momentum.length || 1;

  if (stalled / active > 0.5) return "stalled";
  if (risk === "critical") return "slipping";
  if (totalDelta > 1.5) return "accelerating";
  if (totalDelta < -1.5) return "slipping";
  return "steady";
}

// --- assembly --------------------------------------------------------------

export interface EngineInput {
  projects: Project[];
  tasks: Task[];
  opportunities: Opportunity[];
  events: TrajectoryEvent[];
  entities: Entity[];
}

export interface EngineOutput {
  signals: StateSignals;
  bottleneck?: Bottleneck;
  trajectory: TrajectoryDirection;
  riskLevel: RiskLevel;
  riskFactors: string[];
  commercialMomentum: number;
  todaysObjective: string;
}

export function runEngine(input: EngineInput): EngineOutput {
  const { projects, tasks, opportunities, events, entities } = input;

  const projectMomentum = computeProjectMomentum(projects, events);
  const commercial = computeCommercialMomentum(opportunities);
  const bottleneck = computeBottleneck(tasks, projects);
  const candidates = computeCandidates(
    tasks,
    projects,
    opportunities,
    entities,
    bottleneck,
  );
  const waiting = computeWaiting(tasks, entities);
  const blocked = tasks.filter(
    (t) =>
      t.status === "blocked" ||
      t.blockedBy.some((id) => tasks.find((x) => x.id === id)?.status !== "done"),
  );
  const outstandingCommitments = tasks.filter(
    (t) => t.status !== "done" && Boolean(t.dueAt),
  );
  const overdueCount = outstandingCommitments.filter(
    (t) => new Date(t.dueAt!).getTime() < Date.now(),
  ).length;

  const risk = computeRisk({
    overdueCount,
    staleOpportunities: commercial.stale,
    waiting,
    blocked,
    commercialMomentum: commercial.score,
    bottleneck,
  });

  const trajectory = computeDirection(
    projectMomentum,
    commercial.delta,
    risk.level,
  );

  const eventsLast24h = events.filter(
    (e) => daysBetween(e.occurredAt) <= 1,
  ).length;

  const top = candidates[0];

  /**
   * The objective is what the day is *for*; the recommended action is what to
   * do *first*. Those are usually the same thing, but not always: a 30-minute
   * time-critical follow-up can out-score a 6-hour bottleneck on leverage per
   * hour and still not be what the day is about.
   *
   * When they diverge, say so explicitly rather than letting the dashboard show
   * two headline items that appear to contradict each other.
   */
  let todaysObjective: string;
  if (!top) {
    todaysObjective = "No blocking work — push the highest-value project forward";
  } else if (!bottleneck || bottleneck.id === top.id) {
    todaysObjective = bottleneck
      ? `Clear the bottleneck: ${bottleneck.title}`
      : top.title;
  } else {
    todaysObjective = `Clear the bottleneck: ${bottleneck.title} — after ${formatQuickWin(top)}`;
  }

  return {
    signals: {
      projectMomentum,
      commercialMomentum: commercial.score,
      commercialDelta: commercial.delta,
      candidates,
      waiting,
      blocked,
      outstandingCommitments,
      overdueCount,
      staleOpportunities: commercial.stale,
      eventsLast24h,
    },
    bottleneck,
    trajectory,
    riskLevel: risk.level,
    riskFactors: risk.factors,
    commercialMomentum: commercial.score,
    todaysObjective,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "the 30-minute Company X follow-up" — reads naturally inside a sentence. */
function formatQuickWin(candidate: ScoredCandidate): string {
  const mins = Math.round(candidate.effortHours * 60);
  const duration = mins < 60 ? `${mins}-minute` : `${candidate.effortHours}h`;
  const title = candidate.title.replace(/\.$/, "");
  return `the ${duration} ${lowerFirst(title)}`;
}

const lowerFirst = (s: string) =>
  s && s[0] === s[0].toUpperCase() && s.slice(1) !== s.slice(1).toUpperCase()
    ? s.charAt(0).toLowerCase() + s.slice(1)
    : s;
