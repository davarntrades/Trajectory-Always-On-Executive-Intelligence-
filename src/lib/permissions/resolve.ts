/**
 * The permission decision, as a pure function.
 *
 * Split out from the composed module so the rules can be asserted directly
 * rather than inferred through a connector registry and a request-scoped
 * store. Nothing here reads configuration or performs I/O.
 *
 * These tiers describe **how much action is being requested**. They are not a
 * verdict on whether a proposed external transition may execute — that is a
 * separate decision, made by a separate authority, and the two vocabularies
 * are kept apart deliberately.
 */

import type { ActionTier, PermissionPolicy } from "../types.ts";

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

/** Most specific wins: connector+capability, then capability, then wildcard. */
export function resolvePolicy(
  policies: PermissionPolicy[],
  connectorId: string | undefined,
  capability: string,
): PermissionPolicy | undefined {
  return (
    policies.find((p) => p.connectorId === connectorId && p.capability === capability) ??
    policies.find((p) => !p.connectorId && p.capability === capability) ??
    policies.find((p) => p.capability === "*")
  );
}

export interface DecideInput {
  connectorId?: string;
  capability: string;
  requestedTier: ActionTier;
  policies: PermissionPolicy[];
  /**
   * The capability's declared hard ceiling, or `null` when the connector is
   * known but does not declare the capability at all.
   */
  declaredCeiling: ActionTier | null;
  /** False when the connector id was not recognised. */
  connectorKnown: boolean;
}

/**
 * Two independent ceilings must both allow a tier: the capability's declared
 * hard cap, which policy can never raise, and the owner's policy for that
 * capability, which defaults to `recommend`.
 */
export function decide(input: DecideInput): PermissionDecision {
  const { connectorId, capability, requestedTier, policies } = input;

  if (connectorId && input.connectorKnown && input.declaredCeiling === null) {
    return {
      allowed: false,
      effectiveTier: "observe",
      requestedTier,
      downgraded: false,
      reason: `${connectorId} does not declare capability "${capability}"`,
    };
  }

  const hardCeiling = input.declaredCeiling ?? "recommend";
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
