/**
 * Permission model — composed entry point.
 *
 * Five ascending tiers. An action declares the tier it needs; this decides
 * whether it proceeds, is downgraded, or is refused. The rules themselves live
 * in `./resolve.ts` as pure functions; this module supplies the connector
 * registry they need.
 *
 * `execute` is opt-in per capability and never inherited from a wildcard.
 */

import { getConnector } from "@/lib/connectors";
import type { ActionTier, PermissionPolicy } from "@/lib/types";
import { decide, DEFAULT_POLICIES, type PermissionDecision } from "./resolve";

export {
  DEFAULT_POLICIES,
  TIER_DESCRIPTIONS,
  TIER_ORDER,
  hasSideEffect,
  requiresApproval,
  resolvePolicy,
  tierRank,
  type PermissionDecision,
} from "./resolve";

export function evaluate(input: {
  connectorId?: string;
  capability: string;
  requestedTier: ActionTier;
  policies?: PermissionPolicy[];
}): PermissionDecision {
  const connector = input.connectorId ? getConnector(input.connectorId) : undefined;
  const declared = connector?.capabilities.find((c) => c.id === input.capability);

  return decide({
    connectorId: input.connectorId,
    capability: input.capability,
    requestedTier: input.requestedTier,
    policies: input.policies ?? DEFAULT_POLICIES,
    connectorKnown: Boolean(connector),
    declaredCeiling: declared?.maxTier ?? null,
  });
}
