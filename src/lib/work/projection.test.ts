import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROJECTED_EFFORT_HOURS,
  PROJECTED_IMPACT,
  mergeTasksWithWorkItems,
  projectWorkItem,
  workItemsAsTasks,
} from "./projection.ts";
import { normaliseGitHubPullRequest } from "./canonical.ts";
import type { WorkItem, WorkItemStatus } from "./types.ts";
import type { Task } from "../types.ts";
import { computeBottleneck, computeCandidates } from "../state/engine.ts";

const REPO = "davarntrades/Trajectory-Always-On-Executive-Intelligence-";
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

function workItem(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    status: "open",
    source: "github_pull_request",
    blockedBy: [],
    createdAt: ago(48 * HOUR),
    updatedAt: ago(HOUR),
    ...overrides,
  };
}

test("each work-item status projects onto a task status", () => {
  const expected: Record<WorkItemStatus, Task["status"]> = {
    open: "open",
    active: "in_progress",
    blocked: "blocked",
    completed: "done",
    superseded: "done",
  };

  for (const [status, taskStatus] of Object.entries(expected)) {
    const projected = projectWorkItem(workItem({ id: `x:${status}`, title: status, status: status as WorkItemStatus }));
    assert.equal(projected.status, taskStatus, `${status} must project to ${taskStatus}`);
  }
});

test("a draft projects as in progress, never as blocked", () => {
  // Issue #13 in the engine's vocabulary: unfinished is not obstructed.
  const draft = normaliseGitHubPullRequest(
    { number: 14, title: "Draft", state: "open", draft: true, html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );
  const projected = projectWorkItem(draft);
  assert.equal(projected.status, "in_progress");
  assert.notEqual(projected.status, "blocked");
});

test("superseded work projects as done so it cannot hold dependents shut", () => {
  // computeCandidates skips any task whose blockers are not `done`. An
  // abandoned blocker left in a non-terminal status would block its dependents
  // permanently.
  const abandoned = workItem({ id: "blocker", title: "Abandoned approach", status: "superseded" });
  const dependent = workItem({ id: "dependent", title: "Waiting on it", blockedBy: ["blocker"] });

  const tasks = workItemsAsTasks([abandoned, dependent]);
  const candidates = computeCandidates(tasks, [], [], []);

  assert.ok(
    candidates.some((candidate) => candidate.id === "dependent"),
    "the dependent must be free to move once its blocker is terminal",
  );
});

test("an open blocker does hold its dependent", () => {
  const blocker = workItem({ id: "blocker", title: "Still open" });
  const dependent = workItem({ id: "dependent", title: "Waiting on it", blockedBy: ["blocker"] });

  const candidates = computeCandidates(workItemsAsTasks([blocker, dependent]), [], [], []);

  assert.ok(!candidates.some((candidate) => candidate.id === "dependent"));
  assert.ok(candidates.some((candidate) => candidate.id === "blocker"));
});

test("live work reaches the deterministic engine as scored candidates", () => {
  // The reconciliation this projection exists for: before it, the engine
  // computed leverage over seeded tasks only, and real GitHub work reached the
  // model as prompt text with no leverage, bottleneck or ranking attached.
  const items = [
    workItem({ id: "github_issue:repo#8", title: "Cinematic motion", source: "github_issue" }),
    workItem({ id: "github_pull_request:repo#14", title: "Draft state semantics", draft: true }),
    workItem({ id: "github_pull_request:repo#11", title: "Already merged", status: "completed", completedAt: ago(2 * HOUR) }),
  ];

  const candidates = computeCandidates(workItemsAsTasks(items), [], [], []);
  const ids = candidates.map((candidate) => candidate.id);

  assert.ok(ids.includes("github_issue:repo#8"));
  assert.ok(ids.includes("github_pull_request:repo#14"));
  assert.ok(!ids.includes("github_pull_request:repo#11"), "completed work is never a candidate");

  for (const candidate of candidates) {
    assert.ok(candidate.factors.length, "every candidate carries an inspectable trace");
  }
});

test("a blocking graph across work items produces a bottleneck", () => {
  const blocker = workItem({ id: "blocker", title: "The thing in the way" });
  const items = [
    blocker,
    workItem({ id: "a", title: "A", blockedBy: ["blocker"] }),
    workItem({ id: "b", title: "B", blockedBy: ["blocker"] }),
  ];

  const bottleneck = computeBottleneckFromTasks(workItemsAsTasks(items));
  assert.equal(bottleneck?.id, "blocker");
  assert.equal(bottleneck?.dependencyCount, 2);
});

function computeBottleneckFromTasks(tasks: Task[]) {
  return computeBottleneck(tasks, []);
}

test("projected weights are uniform, so no fabricated ranking is introduced", () => {
  // Ranking among projected items must come from evidence Trajectory holds —
  // the blocking graph and status — not from invented impact estimates.
  const tasks = workItemsAsTasks([
    workItem({ id: "one", title: "One" }),
    workItem({ id: "two", title: "Two" }),
  ]);
  for (const task of tasks) {
    assert.equal(task.impact, PROJECTED_IMPACT);
    assert.equal(task.effortHours, PROJECTED_EFFORT_HOURS);
  }
});

test("merging keeps stored tasks and lets live work win an id collision", () => {
  const stored: Task[] = [
    { id: "task-1", title: "A typed task", status: "open", effortHours: 1, impact: 0.9, blockedBy: [] },
    { id: "github_issue:repo#8", title: "Stale copy", status: "open", effortHours: 1, impact: 0.1, blockedBy: [] },
  ];
  const merged = mergeTasksWithWorkItems(stored, [
    workItem({ id: "github_issue:repo#8", title: "Live copy", source: "github_issue" }),
  ]);

  assert.equal(merged.length, 2, "no duplication");
  assert.equal(merged.find((task) => task.id === "task-1")?.impact, 0.9, "typed tasks are untouched");
  assert.equal(merged.find((task) => task.id === "github_issue:repo#8")?.title, "Live copy");
});

test("an empty work set leaves the task list exactly as it was", () => {
  const stored: Task[] = [
    { id: "task-1", title: "A typed task", status: "open", effortHours: 1, impact: 0.9, blockedBy: [] },
  ];
  assert.deepEqual(mergeTasksWithWorkItems(stored, []), stored);
});
