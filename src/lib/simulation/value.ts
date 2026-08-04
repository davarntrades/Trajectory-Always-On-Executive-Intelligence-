/**
 * The value function.
 *
 * What makes one future better than another must ladder to Objectives, or the
 * simulator optimises something nobody asked for (SIMULATION.md §5).
 *
 * Risk is not re-implemented here: the terminal world is projected back into the
 * shape `computeRisk` already expects, so "risk" in a simulated future means
 * exactly what it means today.
 */

import { computeRisk } from "@/lib/state/engine";
import type { Goal, Opportunity, Task } from "@/lib/types";
import type { SimWorld } from "./model";

export interface ObjectiveSpec {
  id: string;
  label: string;
  weight: number;
  /** Fractional progress in [0,1] achieved during the simulated horizon. */
  progress: (world: SimWorld) => number;
  /** Whether the objective is on track at the end of the horizon. */
  onTrack: (world: SimWorld) => boolean;
}

/** Pull a monetary target out of free-text like "£250,000 ARR". */
function parseMonetaryTarget(target?: string): number | null {
  if (!target) return null;
  const match = target.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!match) return null;
  const n = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") return n * 1_000;
  if (suffix === "m") return n * 1_000_000;
  return n;
}

/**
 * Turn objectives into scorable specs.
 *
 * Revenue objectives score on closed-won value; everything else scores on
 * completion of the work that ladders to it.
 */
export function buildObjectiveSpecs(
  goals: Goal[],
  tasksByProject: Map<string, string[]>,
  projectIdsByGoal: Map<string, string[]>,
  horizonDays: number,
): ObjectiveSpec[] {
  const active = goals.filter((g) => g.status === "active");
  const totalPriority = active.reduce((s, g) => s + 1 / g.priority, 0) || 1;

  return active.map((goal) => {
    const weight = 1 / goal.priority / totalPriority;
    const monetary = parseMonetaryTarget(goal.target);
    const projectIds = projectIdsByGoal.get(goal.id) ?? [];
    const gatingTasks = projectIds.flatMap((p) => tasksByProject.get(p) ?? []);

    if (monetary) {
      // Pro-rata over the horizon: a quarterly target is not due in three weeks.
      const proRata = monetary * (horizonDays / 90);
      return {
        id: goal.id,
        label: goal.title,
        weight,
        progress: (w) => Math.min(1, w.closedWonValue / Math.max(1, proRata)),
        onTrack: (w) => w.closedWonValue >= proRata * 0.6,
      };
    }

    return {
      id: goal.id,
      label: goal.title,
      weight,
      progress: (w) => {
        if (!gatingTasks.length) return 0;
        const done = gatingTasks.filter((id) => w.completedTaskIds.includes(id));
        return done.length / gatingTasks.length;
      },
      onTrack: (w) => {
        if (!gatingTasks.length) return true;
        const done = gatingTasks.filter((id) => w.completedTaskIds.includes(id));
        return done.length / gatingTasks.length >= 0.5;
      },
    };
  });
}

/**
 * Project the simulated world back into the inputs `computeRisk` expects, so the
 * risk term is computed by the production function rather than a copy of it.
 */
function terminalRisk(world: SimWorld): number {
  const stale: Opportunity[] = world.opportunities
    .filter((o) => o.alive && o.daysSinceContact > o.expectedReplyDays)
    .map((o) => ({
      id: o.id,
      name: o.name,
      stage: o.stage,
      value: o.value,
      currency: "GBP",
      probability: 0.4,
      expectedReplyDays: o.expectedReplyDays,
    }));

  const blocked: Task[] = world.tasks
    .filter(
      (t) =>
        !t.done &&
        t.blockedBy.some((id) => !world.tasks.find((x) => x.id === id)?.done),
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: "blocked",
      effortHours: t.effortRemaining,
      impact: t.impact,
      blockedBy: t.blockedBy,
    }));

  const waiting = world.waiting
    .filter((w) => !w.replied)
    .map((w) => ({
      id: w.taskId,
      title: w.taskId,
      waitingOn: w.personId ?? "unknown",
      daysWaiting: Math.round(w.daysWaiting),
      overdue: w.daysWaiting > 5,
    }));

  const overdueCount = world.tasks.filter(
    (t) => !t.done && t.dueInDays !== undefined && t.dueInDays < 0,
  ).length;

  const liveValue = world.opportunities
    .filter((o) => o.alive)
    .reduce((s, o) => s + o.value, 0);
  const commercialMomentum =
    liveValue > 0 ? Math.min(1, world.closedWonValue / liveValue + 0.3) : 0.3;

  return computeRisk({
    overdueCount,
    staleOpportunities: stale,
    waiting,
    blocked,
    commercialMomentum,
  }).score;
}

export interface ValueBreakdown {
  total: number;
  objectiveProgress: Record<string, number>;
  riskPenalty: number;
}

export interface ValueOptions {
  /** Weight on the risk term. */
  riskAversion?: number;
  /** Temporal discount applied across the horizon. */
  discount?: number;
}

export function evaluate(
  world: SimWorld,
  specs: ObjectiveSpec[],
  options: ValueOptions = {},
): ValueBreakdown {
  const { riskAversion = 0.04, discount = 0.95 } = options;

  let total = 0;
  const objectiveProgress: Record<string, number> = {};

  for (const spec of specs) {
    const p = spec.progress(world);
    objectiveProgress[spec.id] = p;
    total += spec.weight * p;
  }

  total *= discount;

  const riskPenalty = riskAversion * terminalRisk(world);
  return { total: total - riskPenalty, objectiveProgress, riskPenalty };
}
