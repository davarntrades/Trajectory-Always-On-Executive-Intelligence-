/**
 * The execution gate, as a pure function.
 *
 * Before this existed, `execute()` read:
 *
 *     if (action.status !== "approved" && action.tier !== "execute") refuse
 *
 * so an action created at tier `execute` ran with no human decision and no
 * external check — the tier granted its own authority. That is the one path
 * this gate closes.
 *
 * **Trajectory permission tiers are not an execution verdict.** A tier says how
 * much action was requested and permitted; it does not say whether a proposed
 * external transition may take place. Nothing here invents a verdict on that
 * question. Autonomous execution is refused because no authority capable of
 * deciding it is wired in, and a missing authority must fail closed — a
 * capability that cannot be evaluated is never a capability that proceeds.
 */

import type { ActionStatus, ActionTier } from "../types.ts";
import { hasSideEffect } from "../permissions/resolve.ts";

export interface GateSubject {
  status: ActionStatus;
  tier: ActionTier;
}

export type GateDecision =
  | { permitted: true }
  | {
      permitted: false;
      /** Audit event name for the refusal. */
      event: "execution_refused";
      reason: string;
      /**
       * True when the refusal is caused by absent authority rather than by the
       * action's own state. These are the cases that become executable once an
       * execution authority is wired in; everything else stays refused.
       */
      awaitingAuthority: boolean;
    };

const refuse = (reason: string, awaitingAuthority = false): GateDecision => ({
  permitted: false,
  event: "execution_refused",
  reason,
  awaitingAuthority,
});

export function executionGate(action: GateSubject): GateDecision {
  // Replay protection. An executed action is a completed external transition;
  // running it again is a second transition, not a retry of the first.
  if (action.status === "executed") {
    return refuse("already executed");
  }
  if (action.status === "rejected") {
    return refuse("rejected by the owner");
  }
  if (!hasSideEffect(action.tier)) {
    // observe / recommend / draft produce nothing external, so there is
    // nothing for execution to do.
    return refuse(`tier ${action.tier} has no external effect to execute`);
  }
  if (action.tier === "execute") {
    return refuse(
      "autonomous execution requires an execution authority; none is configured",
      true,
    );
  }
  if (action.status !== "approved") {
    return refuse(`status is ${action.status}, not approved`);
  }
  return { permitted: true };
}
