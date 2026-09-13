import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POLICIES,
  decide,
  hasSideEffect,
  requiresApproval,
  resolvePolicy,
  tierRank,
} from "./resolve.ts";
import type { PermissionPolicy } from "../types.ts";

const base = {
  capability: "send_email",
  connectorId: "gmail",
  policies: DEFAULT_POLICIES,
  connectorKnown: true,
};

test("a request within both ceilings is permitted unchanged", () => {
  const decision = decide({ ...base, requestedTier: "draft", declaredCeiling: "execute" });
  assert.equal(decision.allowed, true);
  assert.equal(decision.effectiveTier, "draft");
  assert.equal(decision.downgraded, false);
});

test("policy caps a request below the capability's hard ceiling", () => {
  // send_email may reach execute by declaration, but the default policy stops
  // at approve. The lower of the two ceilings must win.
  const decision = decide({ ...base, requestedTier: "execute", declaredCeiling: "execute" });
  assert.equal(decision.allowed, true);
  assert.equal(decision.effectiveTier, "approve");
  assert.equal(decision.downgraded, true);
  assert.match(decision.reason, /policy caps/);
});

test("the capability ceiling caps a request the policy would have allowed", () => {
  const generous: PermissionPolicy[] = [{ capability: "*", maxTier: "execute" }];
  const decision = decide({
    ...base,
    capability: "read_messages",
    policies: generous,
    requestedTier: "execute",
    declaredCeiling: "observe",
  });
  assert.equal(decision.effectiveTier, "observe");
  assert.match(decision.reason, /capability ceiling/);
});

test("execute is never inherited from a wildcard", () => {
  // The wildcard grants execute, but a capability that does not itself declare
  // execute must not reach it.
  const generous: PermissionPolicy[] = [{ capability: "*", maxTier: "execute" }];
  const decision = decide({
    ...base,
    capability: "comment",
    connectorId: "github",
    policies: generous,
    requestedTier: "execute",
    declaredCeiling: "approve",
  });
  assert.equal(decision.effectiveTier, "approve");
});

test("an undeclared capability on a known connector is refused outright", () => {
  const decision = decide({
    ...base,
    capability: "delete_everything",
    requestedTier: "observe",
    declaredCeiling: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.effectiveTier, "observe");
  assert.match(decision.reason, /does not declare capability/);
});

test("an unknown connector falls back to the recommend ceiling rather than refusing", () => {
  const decision = decide({
    ...base,
    connectorId: "not-a-connector",
    connectorKnown: false,
    requestedTier: "execute",
    declaredCeiling: null,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.effectiveTier, "recommend");
});

test("stored policy resolution prefers the most specific match", () => {
  const policies: PermissionPolicy[] = [
    { capability: "*", maxTier: "observe" },
    { capability: "send_email", maxTier: "draft" },
    { connectorId: "gmail", capability: "send_email", maxTier: "approve" },
  ];
  assert.equal(resolvePolicy(policies, "gmail", "send_email")?.maxTier, "approve");
  assert.equal(resolvePolicy(policies, "other", "send_email")?.maxTier, "draft");
  assert.equal(resolvePolicy(policies, "gmail", "anything_else")?.maxTier, "observe");
});

test("a stored policy actually changes the outcome", () => {
  // This is the regression that mattered: policies were resolved correctly but
  // never loaded, so stored rows had no effect on any decision.
  const stored: PermissionPolicy[] = [
    { capability: "*", maxTier: "recommend" },
    { connectorId: "gmail", capability: "send_email", maxTier: "draft" },
  ];
  const withDefaults = decide({ ...base, requestedTier: "approve", declaredCeiling: "execute" });
  const withStored = decide({ ...base, policies: stored, requestedTier: "approve", declaredCeiling: "execute" });

  assert.equal(withDefaults.effectiveTier, "approve");
  assert.equal(withStored.effectiveTier, "draft", "the owner's stored ceiling must bind");
});

test("tiers are ordered, and side effects begin at approve", () => {
  assert.ok(tierRank("observe") < tierRank("recommend"));
  assert.ok(tierRank("approve") < tierRank("execute"));
  assert.equal(hasSideEffect("draft"), false);
  assert.equal(hasSideEffect("approve"), true);
  assert.equal(hasSideEffect("execute"), true);
  assert.equal(requiresApproval("approve"), true);
  assert.equal(requiresApproval("execute"), false);
});
