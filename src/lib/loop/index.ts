/**
 * The continuous executive loop.
 *
 *   observe → update memory → update state → detect meaningful change
 *          → recompute trajectory → generate recommendations → notify
 *
 * The trigger is a meaningful change in state, not the passage of time. A pass
 * that finds nothing consequential does its work and stays silent — that
 * silence is the feature. Trajectory earns the right to interrupt by being
 * right about what matters, and it spends that right sparingly.
 *
 * This is the same function whether it is invoked by a webhook, a cron tick, or
 * an operator hitting refresh. Only the caller differs.
 */

import { computeState } from "@/lib/state/compute";
import { getStore, type StoredNotification } from "@/lib/store";
import { runSync } from "@/lib/workers/sync";
import type { TrajectoryState } from "@/lib/types";
import { detectChanges, warrantsInterrupt, type StateDelta } from "./delta";
import {
  buildCadenceBrief,
  buildInterrupt,
  cadenceFor,
  type Cadence,
  type Notification,
} from "./notify";

export * from "./delta";
export * from "./notify";

export interface LoopResult {
  ranAt: string;
  /** Events pulled in during the observe phase. */
  observed: number;
  state: TrajectoryState;
  delta: StateDelta;
  /** Emitted only when something crossed the interrupt threshold. */
  interrupt?: Notification;
  /** Emitted when a cadence boundary has been crossed since the last brief. */
  brief?: Notification;
  /** Why the loop did or did not speak — the auditable part. */
  decision: string;
  durationMs: number;
}

export interface LoopOptions {
  /** Pull from connectors first. Off when the caller already ingested. */
  observe?: boolean;
  /** Force a cadence brief regardless of whether the boundary was crossed. */
  forceBrief?: Cadence | false;
  /** Emit notifications even below threshold. For testing the loop. */
  alwaysNotify?: boolean;
  trajectories?: number;
}

/**
 * Has a cadence boundary been crossed since the last digest went out?
 *
 * This is what stops three morning briefs from firing when the loop happens to
 * run three times before 11am.
 */
function cadenceDue(
  now: string,
  previousDigests: StoredNotification[],
): Cadence | null {
  const cadence = cadenceFor(now);
  const today = now.slice(0, 10);

  const already = previousDigests.some(
    (n) => n.channel === "digest" && n.cadence === cadence && n.at.slice(0, 10) === today,
  );
  return already ? null : cadence;
}

export async function runLoop(options: LoopOptions = {}): Promise<LoopResult> {
  const started = Date.now();
  const { observe = true, alwaysNotify = false } = options;
  const store = await getStore();

  // 1. Observe -------------------------------------------------------------
  let observed = 0;
  if (observe) {
    try {
      // Recompute is handled below; the sync pass only gathers.
      const sync = await runSync({ recompute: false });
      observed = sync.totalNewEvents;
    } catch (err) {
      console.error("[loop] observe failed:", err);
    }
  }

  // 2. Capture the prior state *before* recomputing, or there is nothing to
  //    diff against — computeState persists a new snapshot.
  const previous = await store.latestSnapshot();

  // 3. Update state + 4. recompute trajectory (simulation runs inside).
  const state = await computeState({
    persist: true,
    trajectories: options.trajectories,
  });

  // 5. Detect meaningful change -------------------------------------------
  const recentEvents = await store.events(1);
  const delta = detectChanges(previous, state, recentEvents);

  // 6/7. Notify — only when it is warranted -------------------------------
  const notifications = await store.notifications(50);
  const dueCadence =
    options.forceBrief === false
      ? null
      : (options.forceBrief ?? cadenceDue(state.computedAt, notifications));

  let interrupt: Notification | undefined;
  let brief: Notification | undefined;
  const reasons: string[] = [];

  if (!previous) {
    // First run establishes a baseline. Interrupting about a world the user has
    // not seen yet is noise, not signal.
    reasons.push("first run — baseline established, staying silent");
  } else if (warrantsInterrupt(delta) || alwaysNotify) {
    interrupt = buildInterrupt(state, delta) ?? undefined;
    if (interrupt) {
      reasons.push(
        `interrupt: ${delta.changes[0].kind} at salience ${delta.peakSalience.toFixed(2)}`,
      );
    }
  } else if (delta.changes.length) {
    reasons.push(
      `${delta.changes.length} change(s) below threshold (peak ${delta.peakSalience.toFixed(2)}) — logged, not pushed`,
    );
  } else {
    reasons.push("no meaningful change");
  }

  if (dueCadence) {
    brief = buildCadenceBrief(state, delta, dueCadence);
    reasons.push(`${dueCadence} brief due`);
  }

  for (const n of [interrupt, brief]) {
    if (!n) continue;
    await store.appendNotification({ ...n, delivered: true });
  }

  await store.appendAudit({
    at: state.computedAt,
    actor: "trajectory",
    event: "loop_pass",
    tier: "observe",
    detail: {
      observed,
      changes: delta.changes.length,
      peakSalience: delta.peakSalience,
      decisionChanged: delta.decisionChanged,
      interrupted: Boolean(interrupt),
      briefed: Boolean(brief),
    },
  });

  return {
    ranAt: state.computedAt,
    observed,
    state,
    delta,
    interrupt,
    brief,
    decision: reasons.join("; "),
    durationMs: Date.now() - started,
  };
}
