/**
 * Meaningful change detection.
 *
 * The executive loop's trigger is not time — it is a change that affects the
 * trajectory. This module decides what counts.
 *
 * Everything here is a pure function of two snapshots plus the events between
 * them, which is only possible because snapshots are append-only and complete
 * (ARCHITECTURE.md §8). There is no separate notification rule engine: what to
 * surface *is* the diff, filtered by salience.
 */

import type { TrajectoryEvent, TrajectoryState } from "@/lib/types";

export type ChangeKind =
  | "recommendation_changed"
  | "bottleneck_changed"
  | "bottleneck_cleared"
  | "risk_escalated"
  | "risk_eased"
  | "momentum_shift"
  | "opportunity_stalled"
  | "reply_received"
  | "dependency_cleared"
  | "deadline_critical"
  | "window_opened"
  | "new_opportunity";

export interface Change {
  kind: ChangeKind;
  /** 0..1. Above `INTERRUPT_THRESHOLD` this is worth breaking focus for. */
  salience: number;
  summary: string;
  why: string;
  /** Entity/task/opportunity this concerns, for linking. */
  subjectId?: string;
}

export interface StateDelta {
  from?: string;
  to: string;
  changes: Change[];
  /** Highest salience in the set — drives the interrupt decision. */
  peakSalience: number;
  /** Did the thing the user should do next actually change? */
  decisionChanged: boolean;
}

/**
 * Below this, a change is recorded but never interrupts. Trajectory earns the
 * right to interrupt by being right about what matters, so this is deliberately
 * high — most changes are logged and shown on next open, not pushed.
 */
export const INTERRUPT_THRESHOLD = 0.62;

const RISK_ORDER = ["low", "elevated", "high", "critical"];

export function detectChanges(
  previous: TrajectoryState | null,
  current: TrajectoryState,
  recentEvents: TrajectoryEvent[] = [],
): StateDelta {
  const changes: Change[] = [];

  // --- the decision itself -------------------------------------------------

  const prevAction = previous?.recommendedAction?.candidateId;
  const nextAction = current.recommendedAction?.candidateId;
  const decisionChanged = Boolean(previous) && prevAction !== nextAction;

  if (decisionChanged && current.recommendedAction) {
    changes.push({
      kind: "recommendation_changed",
      // The single most consequential thing that can change — it is the
      // product's one output.
      salience: 0.85,
      summary: `Highest-leverage action is now: ${current.recommendedAction.title}`,
      why: current.recommendedAction.why,
      subjectId: current.recommendedAction.candidateId,
    });
  }

  // --- bottleneck ----------------------------------------------------------

  const prevBottleneck = previous?.bottleneck;
  const nextBottleneck = current.bottleneck;

  if (prevBottleneck && !nextBottleneck) {
    changes.push({
      kind: "bottleneck_cleared",
      salience: 0.8,
      summary: `Bottleneck cleared: ${prevBottleneck.title}`,
      why: `${prevBottleneck.dependencyCount} item(s) that were blocked can now move.`,
      subjectId: prevBottleneck.id,
    });
  } else if (prevBottleneck && nextBottleneck && prevBottleneck.id !== nextBottleneck.id) {
    changes.push({
      kind: "bottleneck_changed",
      salience: 0.72,
      summary: `Bottleneck moved to: ${nextBottleneck.title}`,
      why: `Holding ${nextBottleneck.dependencyCount} downstream item(s); ${nextBottleneck.effortHours}h to clear.`,
      subjectId: nextBottleneck.id,
    });
  }

  // --- risk ----------------------------------------------------------------

  if (previous) {
    const before = RISK_ORDER.indexOf(previous.riskLevel);
    const after = RISK_ORDER.indexOf(current.riskLevel);
    if (after > before) {
      changes.push({
        kind: "risk_escalated",
        // Escalating into high/critical is always worth an interrupt.
        salience: after >= 2 ? 0.88 : 0.6,
        summary: `Risk rose to ${current.riskLevel}`,
        why: current.signals.staleOpportunities.length
          ? `${current.signals.staleOpportunities.length} opportunit(ies) past their reply window; ${current.signals.overdueCount} overdue commitment(s).`
          : `${current.signals.overdueCount} overdue commitment(s).`,
      });
    } else if (after < before) {
      changes.push({
        kind: "risk_eased",
        salience: 0.4,
        summary: `Risk eased to ${current.riskLevel}`,
        why: "Fewer overdue or stalled items than at the last check.",
      });
    }
  }

  // --- momentum ------------------------------------------------------------

  if (previous) {
    const prevByProject = new Map(
      previous.signals.projectMomentum.map((m) => [m.projectId, m]),
    );
    for (const m of current.signals.projectMomentum) {
      const before = prevByProject.get(m.projectId);
      if (!before || before.status === m.status) continue;

      // Only the transitions that change what you'd do about a project.
      const wentCold = m.status === "stalled" || m.status === "cooling";
      const wentHot = m.status === "hot" && before.status !== "hot";
      if (!wentCold && !wentHot) continue;

      changes.push({
        kind: "momentum_shift",
        salience: m.status === "stalled" ? 0.66 : 0.45,
        summary: `${m.projectName} is now ${m.status}`,
        why: `Momentum ${before.score.toFixed(1)} → ${m.score.toFixed(1)} over the trailing fortnight.`,
        subjectId: m.projectId,
      });
    }
  }

  // --- waiting / replies ---------------------------------------------------

  if (previous) {
    const stillWaiting = new Set(current.signals.waiting.map((w) => w.id));
    for (const w of previous.signals.waiting) {
      if (!stillWaiting.has(w.id)) {
        changes.push({
          kind: "reply_received",
          salience: 0.7,
          summary: `${w.waitingOn} came back on: ${w.title}`,
          why: `You had been waiting ${w.daysWaiting} day(s).`,
          subjectId: w.id,
        });
      }
    }

    // Blocked items that became unblocked.
    const prevBlocked = new Set(previous.signals.blocked.map((t) => t.id));
    const nowBlocked = new Set(current.signals.blocked.map((t) => t.id));
    for (const id of prevBlocked) {
      if (!nowBlocked.has(id)) {
        const task = previous.signals.blocked.find((t) => t.id === id);
        changes.push({
          kind: "dependency_cleared",
          salience: 0.58,
          summary: `Unblocked: ${task?.title ?? id}`,
          why: "Its dependency completed; it can now be worked.",
          subjectId: id,
        });
      }
    }
  }

  // --- commercial ----------------------------------------------------------

  if (previous) {
    const prevStale = new Set(previous.signals.staleOpportunities.map((o) => o.id));
    for (const o of current.signals.staleOpportunities) {
      if (prevStale.has(o.id)) continue;
      changes.push({
        kind: "opportunity_stalled",
        // Scaled by value — a £120k deal going quiet is not a £5k deal going quiet.
        salience: Math.min(0.85, 0.5 + o.value / 400000),
        summary: `${o.name} has gone quiet`,
        why: `Past its ${o.expectedReplyDays}-day reply window at stage ${o.stage}.`,
        subjectId: o.id,
      });
    }
  }

  // --- deadlines -----------------------------------------------------------

  const now = new Date(current.computedAt).getTime();
  for (const t of current.signals.outstandingCommitments) {
    if (!t.dueAt) continue;
    const hoursLeft = (new Date(t.dueAt).getTime() - now) / 36e5;
    if (hoursLeft > 0 && hoursLeft <= 24) {
      const wasCritical = previous?.signals.outstandingCommitments.some(
        (p) =>
          p.id === t.id &&
          p.dueAt &&
          (new Date(p.dueAt).getTime() - new Date(previous.computedAt).getTime()) / 36e5 <=
            24,
      );
      if (wasCritical) continue; // already flagged last cycle
      changes.push({
        kind: "deadline_critical",
        salience: 0.75,
        summary: `Due within 24h: ${t.title}`,
        why: `${t.effortHours}h of work remaining.`,
        subjectId: t.id,
      });
    }
  }

  // --- event-derived: things that create or destroy opportunity ------------

  for (const e of recentEvents) {
    if (e.type === "calendar.event_cancelled") {
      const freedMinutes = Number(e.payload.durationMinutes ?? 60);
      changes.push({
        kind: "window_opened",
        // A freed block is only interesting if it is big enough to use.
        salience: freedMinutes >= 45 ? 0.68 : 0.35,
        summary: `${freedMinutes} minutes freed up — ${e.title}`,
        why: "Cancelled meeting has opened a block of working time.",
        subjectId: e.id,
      });
    }
    if (e.type === "opportunity.created" || e.type === "lead.inbound") {
      changes.push({
        kind: "new_opportunity",
        salience: 0.6,
        summary: `New opportunity: ${e.title}`,
        why: "Arrived since the last check and is not yet qualified.",
        subjectId: e.id,
      });
    }
  }

  changes.sort((a, b) => b.salience - a.salience);

  return {
    from: previous?.computedAt,
    to: current.computedAt,
    changes,
    peakSalience: changes[0]?.salience ?? 0,
    decisionChanged,
  };
}

/** Does this delta justify breaking the user's focus right now? */
export function warrantsInterrupt(delta: StateDelta): boolean {
  return delta.peakSalience >= INTERRUPT_THRESHOLD;
}
