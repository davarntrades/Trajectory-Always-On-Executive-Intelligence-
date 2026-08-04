/**
 * Action pipeline.
 *
 * Every proposal, approval, rejection and execution writes an audit row. There
 * is no path that mutates the outside world without leaving a record of what
 * was done, at which tier, and which computed state motivated it.
 */

import { evaluate, requiresApproval } from "@/lib/permissions";
import { getStore } from "@/lib/store";
import type { ActionTier, TrajectoryAction } from "@/lib/types";

export interface ProposeInput {
  connectorId?: string;
  capability: string;
  requestedTier: ActionTier;
  summary: string;
  payload?: Record<string, unknown>;
  rationale?: string;
}

export async function propose(input: ProposeInput): Promise<TrajectoryAction> {
  const store = await getStore();
  const decision = evaluate({
    connectorId: input.connectorId,
    capability: input.capability,
    requestedTier: input.requestedTier,
  });

  // A refused request is still recorded. An action that was attempted and
  // denied is exactly the kind of thing an audit trail exists to capture.
  const status = !decision.allowed
    ? "rejected"
    : requiresApproval(decision.effectiveTier)
      ? "awaiting_approval"
      : "proposed";

  const action: TrajectoryAction = {
    id: crypto.randomUUID(),
    connectorId: input.connectorId,
    capability: input.capability,
    tier: decision.effectiveTier,
    status,
    summary: input.summary,
    payload: input.payload ?? {},
    rationale: input.rationale,
    createdAt: new Date().toISOString(),
  };

  await store.saveAction(action);
  await store.appendAudit({
    actionId: action.id,
    at: action.createdAt,
    actor: "trajectory",
    event: decision.allowed ? "proposed" : "refused",
    tier: action.tier,
    detail: {
      capability: input.capability,
      connectorId: input.connectorId ?? null,
      requestedTier: decision.requestedTier,
      effectiveTier: decision.effectiveTier,
      downgraded: decision.downgraded,
      allowed: decision.allowed,
      reason: decision.reason,
      rationale: input.rationale ?? null,
    },
  });

  return action;
}

export async function decide(
  actionId: string,
  outcome: "approved" | "rejected",
  actor = "davarn",
  note?: string,
): Promise<TrajectoryAction | null> {
  const store = await getStore();
  const action = (await store.actions()).find((a) => a.id === actionId);
  if (!action) return null;

  const updated: TrajectoryAction = { ...action, status: outcome };
  await store.saveAction(updated);
  await store.appendAudit({
    actionId,
    at: new Date().toISOString(),
    actor,
    event: outcome,
    tier: action.tier,
    detail: { note: note ?? null },
  });

  return updated;
}

/**
 * Execute an approved action.
 *
 * Phase 1 has no live connector write paths, so this records the attempt and
 * marks it executed without an external call. When Phase 2 lands, the connector
 * dispatch goes here — the audit contract around it does not change.
 */
export async function execute(actionId: string): Promise<TrajectoryAction | null> {
  const store = await getStore();
  const action = (await store.actions()).find((a) => a.id === actionId);
  if (!action) return null;

  if (action.status !== "approved" && action.tier !== "execute") {
    await store.appendAudit({
      actionId,
      at: new Date().toISOString(),
      actor: "trajectory",
      event: "execution_refused",
      tier: action.tier,
      detail: { reason: `status is ${action.status}, not approved` },
    });
    return action;
  }

  const updated: TrajectoryAction = { ...action, status: "executed" };
  await store.saveAction(updated);
  await store.appendAudit({
    actionId,
    at: new Date().toISOString(),
    actor: "trajectory",
    event: "executed",
    tier: action.tier,
    detail: {
      connectorId: action.connectorId ?? null,
      capability: action.capability,
      note: "Phase 1: recorded without external dispatch",
    },
  });

  return updated;
}
