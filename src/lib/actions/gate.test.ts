import { test } from "node:test";
import assert from "node:assert/strict";

import { executionGate } from "./gate.ts";
import type { ActionStatus, ActionTier } from "../types.ts";

const subject = (tier: ActionTier, status: ActionStatus) => ({ tier, status });

test("an approved side-effecting action may execute", () => {
  assert.deepEqual(executionGate(subject("approve", "approved")), { permitted: true });
});

test("the execute tier no longer grants its own authority", () => {
  // The bypass this gate exists to close. Previously an action created at tier
  // `execute` ran with no human decision and no external check, because the
  // condition was `status !== "approved" && tier !== "execute"`.
  const decision = executionGate(subject("execute", "proposed"));
  assert.equal(decision.permitted, false);
  assert.ok(!decision.permitted && decision.awaitingAuthority, "refused for want of an authority, not for its own state");
  assert.match(!decision.permitted ? decision.reason : "", /execution authority/);
});

test("an approved execute-tier action is still refused while no authority exists", () => {
  // Approval is a Trajectory permission decision about how much action was
  // requested. It is not a verdict on whether the external transition may
  // happen, and it must not stand in for one.
  const decision = executionGate(subject("execute", "approved"));
  assert.equal(decision.permitted, false);
  assert.ok(!decision.permitted && decision.awaitingAuthority);
});

test("an unapproved side-effecting action is refused", () => {
  for (const status of ["proposed", "awaiting_approval", "failed"] as ActionStatus[]) {
    const decision = executionGate(subject("approve", status));
    assert.equal(decision.permitted, false, `${status} must not execute`);
    assert.ok(!decision.permitted && !decision.awaitingAuthority, `${status} is refused on its own state`);
  }
});

test("a rejected action can never execute, whatever its tier", () => {
  for (const tier of ["approve", "execute"] as ActionTier[]) {
    const decision = executionGate(subject(tier, "rejected"));
    assert.equal(decision.permitted, false);
    assert.match(!decision.permitted ? decision.reason : "", /rejected/);
  }
});

test("an executed action cannot be executed again", () => {
  // Replay protection: a second execution is a second external transition, not
  // a retry of the first.
  const decision = executionGate(subject("approve", "executed"));
  assert.equal(decision.permitted, false);
  assert.match(!decision.permitted ? decision.reason : "", /already executed/);
});

test("tiers with no external effect have nothing to execute", () => {
  for (const tier of ["observe", "recommend", "draft"] as ActionTier[]) {
    const decision = executionGate(subject(tier, "approved"));
    assert.equal(decision.permitted, false, `${tier} must not reach execution`);
    assert.match(!decision.permitted ? decision.reason : "", /no external effect/);
  }
});

test("no status and tier combination permits execution without approval", () => {
  // Exhaustive, because this is the property that matters: the only way
  // through the gate is an approved, side-effecting, not-yet-executed action.
  const statuses: ActionStatus[] = ["proposed", "awaiting_approval", "approved", "rejected", "executed", "failed"];
  const tiers: ActionTier[] = ["observe", "recommend", "draft", "approve", "execute"];

  const permitted = tiers.flatMap((tier) =>
    statuses.filter((status) => executionGate(subject(tier, status)).permitted).map((status) => `${tier}/${status}`),
  );

  assert.deepEqual(permitted, ["approve/approved"]);
});
