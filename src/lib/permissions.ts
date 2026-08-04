/**
 * Permission model.
 *
 * Five ascending tiers. An action declares the tier it needs; this decides
 * whether it proceeds, is downgraded, or is refused.
 *
 * Two independent ceilings must both allow a tier:
 *   1. The capability's declared ceiling (in the connector definition) — a hard
 *      cap that policy cannot raise. `read_messages` can never reach `execute`.
 *   2. The owner's policy for that capability — defaults to `recommend`.
 *
 * `execute` is opt-in per capability and never inherited from a wildcard.
 */

import { getConnector } from "@/lib/connectors";
import type { ActionTier, PermissionPolicy } from "@/lib/types";

export const TIER_ORDER: ActionTier[] = [
  "observe",
  "recommend",
  "draft",
  "approve",
  "execute",
];

export const tierRank = (tier: ActionTier): number => TIER_ORDER.indexOf(tier);

export const TIER_DESCRIPTIONS: Record<ActionTier, string> = {
  observe: "Read only. No side effects.",
  recommend: "Surface a suggestion. Davarn acts.",
  draft: "Compose but never send.",
  approve: "Queue for explicit approval before it happens.",
  execute: "Act autonomously and report afterwards.",
};

/**
 * Default policy. Deliberately conservative: everything is `recommend` unless
 * explicitly raised. Drafting is allowed for composition capabilities because a
 * draft has no external effect.
 */
export const DEFAULT_POLICIES: PermissionPolicy[] = [
  { capability: "*", maxTier: "recommend" },
  { connectorId: "gmail", capability: "read_messages", maxTier: "observe" },
  { connectorId: "gmail", capability: "draft_email", maxTier: "draft" },
  { connectorId: "gmail", capability: "send_email", maxTier: "approve" },
  { connectorId: "calendar", capability: "read_events", maxTier: "observe" },
  { connectorId: "calendar", capability: "create_event", maxTier: "approve" },
  { connectorId: "github", capability: "read_activity", maxTier: "observe" },
  { connectorId: "notion", capability: "read_pages", maxTier: "observe" },
];

export interface PermissionDecision {
  allowed: boolean;
  /** The tier this action may actually run at. */
  effectiveTier: ActionTier;
  requestedTier: ActionTier;
  /** True when the request was permitted but at a lower tier than asked for. */
  downgraded: boolean;
  reason: string;
}

function resolvePolicy(
  policies: PermissionPolicy[],
  connectorId: string | undefined,
  capability: string,
): PermissionPolicy | undefined {
  // Most specific wins: exact connector+capability, then capability, then wildcard.
  return (
    policies.find((p) => p.connectorId === connectorId && p.capability === capability) ??
    policies.find((p) => !p.connectorId && p.capability === capability) ??
    policies.find((p) => p.capability === "*")
  );
}

export function evaluate(input: {
  connectorId?: string;
  capability: string;
  requestedTier: ActionTier;
  policies?: PermissionPolicy[];
}): PermissionDecision {
  const { connectorId, capability, requestedTier } = input;
  const policies = input.policies ?? DEFAULT_POLICIES;

  // Ceiling 1: what the capability is even allowed to do.
  const connector = connectorId ? getConnector(connectorId) : undefined;
  const declared = connector?.capabilities.find((c) => c.id === capability);

  if (connectorId && connector && !declared) {
    return {
      allowed: false,
      effectiveTier: "observe",
      requestedTier,
      downgraded: false,
      reason: `${connectorId} does not declare capability "${capability}"`,
    };
  }

  const hardCeiling = declared?.maxTier ?? "recommend";

  // Ceiling 2: what policy permits.
  const policy = resolvePolicy(policies, connectorId, capability);
  const policyCeiling = policy?.maxTier ?? "recommend";

  const ceiling =
    tierRank(hardCeiling) <= tierRank(policyCeiling) ? hardCeiling : policyCeiling;

  if (tierRank(requestedTier) <= tierRank(ceiling)) {
    return {
      allowed: true,
      effectiveTier: requestedTier,
      requestedTier,
      downgraded: false,
      reason: `permitted — ceiling for ${capability} is ${ceiling}`,
    };
  }

  // Above the ceiling: downgrade rather than refuse, so the work still surfaces.
  return {
    allowed: true,
    effectiveTier: ceiling,
    requestedTier,
    downgraded: true,
    reason:
      tierRank(hardCeiling) < tierRank(policyCeiling)
        ? `downgraded to ${ceiling}: capability ceiling for ${capability} is ${hardCeiling}`
        : `downgraded to ${ceiling}: policy caps ${capability} at ${policyCeiling}`,
  };
}

/** Whether a tier needs a human decision before anything happens externally. */
export const requiresApproval = (tier: ActionTier): boolean => tier === "approve";

/** Whether a tier causes an external side effect at all. */
export const hasSideEffect = (tier: ActionTier): boolean =>
  tier === "approve" || tier === "execute";
