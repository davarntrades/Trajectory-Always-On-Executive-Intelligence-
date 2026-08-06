import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEvidenceReferences,
  buildWorkBoard,
  evidenceLabel,
  mergeIngested,
  normaliseGitHubIssue,
  normaliseGitHubPullRequest,
  rankOpenWork,
  selectActivePriority,
  selectOpenWork,
  workItemId,
} from "./canonical.ts";
import { isRecommendable, type WorkItem } from "./types.ts";
import { buildStateEvidence } from "../voice/continuity.ts";

const REPO = "davarntrades/Trajectory-Always-On-Executive-Intelligence-";
const NOW = Date.parse("2026-08-06T16:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

function item(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    status: "open",
    source: "launch_backlog",
    blockedBy: [],
    createdAt: ago(48 * HOUR),
    updatedAt: ago(HOUR),
    ...overrides,
  };
}

// --- GitHub normalisation: merged and closed work is completed -------------

test("a merged pull request is completed and carries its merge timestamp", () => {
  const workItem = normaliseGitHubPullRequest(
    {
      number: 11,
      title: "Wire cinematic motion into the live Trajectory experience",
      state: "closed",
      html_url: `https://github.com/${REPO}/pull/11`,
      created_at: ago(30 * HOUR),
      updated_at: ago(2 * HOUR),
      closed_at: ago(2 * HOUR),
      merged_at: ago(2 * HOUR),
    },
    REPO,
  );

  assert.equal(workItem.status, "completed");
  assert.equal(workItem.completedAt, ago(2 * HOUR));
  assert.equal(isRecommendable(workItem), false);
});

test("a pull request closed without merging is superseded, not completed", () => {
  const workItem = normaliseGitHubPullRequest(
    { number: 9, title: "Abandoned approach", state: "closed", html_url: "u", created_at: ago(50 * HOUR), updated_at: ago(20 * HOUR), closed_at: ago(20 * HOUR), merged_at: null },
    REPO,
  );

  assert.equal(workItem.status, "superseded");
  assert.equal(workItem.completedAt, undefined);
  assert.equal(isRecommendable(workItem), false);
});

test("an open pull request is open; a draft is blocked", () => {
  const open = normaliseGitHubPullRequest(
    { number: 12, title: "Live open-work ingestion", state: "open", html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );
  const draft = normaliseGitHubPullRequest(
    { number: 13, title: "Spike", state: "open", draft: true, html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );

  assert.equal(open.status, "open");
  assert.equal(draft.status, "blocked");
  assert.equal(isRecommendable(open), true);
  assert.equal(isRecommendable(draft), true, "blocked work is still live work");
});

test("a closed issue is completed; not_planned is superseded", () => {
  const completed = normaliseGitHubIssue(
    { number: 8, title: "Cinematic Motion System", state: "closed", html_url: "u", created_at: ago(60 * HOUR), updated_at: ago(4 * HOUR), closed_at: ago(4 * HOUR) },
    REPO,
  );
  const dropped = normaliseGitHubIssue(
    { number: 4, title: "Dropped idea", state: "closed", state_reason: "not_planned", html_url: "u", created_at: ago(60 * HOUR), updated_at: ago(40 * HOUR), closed_at: ago(40 * HOUR) },
    REPO,
  );

  assert.equal(completed.status, "completed");
  assert.equal(dropped.status, "superseded");
});

test("a reopened issue returns to the open set and records when", () => {
  // The single documented exception to "closed means completed".
  const reopened = normaliseGitHubIssue(
    { number: 8, title: "Cinematic Motion System", state: "open", html_url: "u", created_at: ago(60 * HOUR), updated_at: ago(HOUR), closed_at: ago(4 * HOUR) },
    REPO,
  );

  assert.equal(reopened.status, "open");
  assert.equal(reopened.reopenedAt, ago(HOUR));
  assert.equal(reopened.completedAt, undefined);
  assert.equal(isRecommendable(reopened), true);
});

test("a blocked label puts an open issue in the blocked column", () => {
  const blocked = normaliseGitHubIssue(
    { number: 20, title: "Waiting on legal", state: "open", labels: [{ name: "Blocked" }], html_url: "u", created_at: ago(20 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );
  assert.equal(blocked.status, "blocked");
});

test("work item ids are stable across re-ingestion", () => {
  const first = normaliseGitHubPullRequest({ number: 11, title: "a", state: "open", html_url: "u", created_at: ago(HOUR), updated_at: ago(HOUR) }, REPO);
  const again = normaliseGitHubPullRequest({ number: 11, title: "a renamed", state: "open", html_url: "u", created_at: ago(HOUR), updated_at: NOW.toString() }, REPO);
  assert.equal(first.id, again.id);
  assert.equal(first.id, workItemId("github_pull_request", REPO, 11));
});

// --- Completed GitHub work cannot resurface as current advice --------------

test("completed GitHub work is excluded from the open-work set", () => {
  const mergedPr = normaliseGitHubPullRequest(
    { number: 7, title: "Repair voice pipeline", state: "closed", html_url: "u", created_at: ago(90 * HOUR), updated_at: ago(70 * HOUR), closed_at: ago(70 * HOUR), merged_at: ago(70 * HOUR) },
    REPO,
  );
  const closedIssue = normaliseGitHubIssue(
    { number: 8, title: "Cinematic Motion System", state: "closed", html_url: "u", created_at: ago(60 * HOUR), updated_at: ago(4 * HOUR), closed_at: ago(4 * HOUR) },
    REPO,
  );
  const openPr = normaliseGitHubPullRequest(
    { number: 12, title: "Live open-work ingestion", state: "open", html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );

  const open = selectOpenWork([mergedPr, closedIssue, openPr]);

  assert.deepEqual(open.map((entry) => entry.id), [openPr.id]);
  assert.ok(!open.some((entry) => entry.title.includes("Repair voice pipeline")));
  assert.ok(!open.some((entry) => entry.title.includes("Cinematic Motion System")));
});

test("completed GitHub work never reaches the prompt as open, and is named as done", () => {
  // This is the end-to-end guard for the original defect: PR #7 was merged, so
  // it must appear only under the completed heading, never the open one.
  const mergedPr = normaliseGitHubPullRequest(
    { number: 7, title: "Repair voice pipeline", state: "closed", html_url: "u", created_at: ago(90 * HOUR), updated_at: ago(70 * HOUR), closed_at: ago(70 * HOUR), merged_at: ago(70 * HOUR) },
    REPO,
  );
  const openPr = normaliseGitHubPullRequest(
    { number: 12, title: "Live open-work ingestion", state: "open", html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );
  const all = [mergedPr, openPr];

  const evidence = buildStateEvidence({
    trajectory: "steady",
    riskLevel: "low",
    eventsLast24h: 2,
    openWork: rankOpenWork(all).map((entry) => ({
      title: entry.title,
      kind: entry.status,
      reference: evidenceLabel(entry),
      updatedAt: entry.updatedAt,
    })),
    completedWork: all
      .filter((entry) => entry.status === "completed")
      .map((entry) => ({ title: entry.title, reference: evidenceLabel(entry), completedAt: entry.completedAt })),
    transcript: "What should I work on",
    now: NOW,
  });

  const openSection = evidence.slice(
    evidence.indexOf("Work still open right now"),
    evidence.indexOf("Already completed"),
  );
  assert.ok(openSection.includes("PR #12"), "the open pull request must be offered");
  assert.ok(!openSection.includes("PR #7"), "merged work must never appear as open");
  assert.match(evidence, /Already completed and therefore not available to recommend/);
  assert.match(evidence, /Repair voice pipeline \[PR #7\], completed 3 days ago/);
});

test("a reopened issue does resurface, because reopening is explicit", () => {
  const reopened = normaliseGitHubIssue(
    { number: 8, title: "Cinematic Motion System", state: "open", html_url: "u", created_at: ago(60 * HOUR), updated_at: ago(HOUR), closed_at: ago(4 * HOUR) },
    REPO,
  );
  assert.deepEqual(selectOpenWork([reopened]).map((entry) => entry.id), [reopened.id]);
});

// --- One active priority ---------------------------------------------------

test("exactly one active priority is selected, the most recently updated", () => {
  const stale = item({ id: "a", title: "Older claim", status: "active", updatedAt: ago(9 * HOUR) });
  const current = item({ id: "b", title: "Current claim", status: "active", updatedAt: ago(HOUR) });

  assert.equal(selectActivePriority([stale, current])?.id, "b");
});

test("a completed item cannot be the active priority", () => {
  const completed = item({ id: "c", title: "Done", status: "completed", completedAt: ago(HOUR) });
  assert.equal(selectActivePriority([completed]), null);
});

test("no active priority is reported rather than inventing one", () => {
  assert.equal(selectActivePriority([item({ id: "d", title: "Open" })]), null);
});

// --- The board -------------------------------------------------------------

test("the board separates active, next open, blocked and recently completed", () => {
  const items = [
    item({ id: "active", title: "Ship ingestion", status: "active", updatedAt: ago(HOUR) }),
    item({ id: "open1", title: "Write the migration", updatedAt: ago(2 * HOUR) }),
    item({ id: "open2", title: "Add the board", updatedAt: ago(3 * HOUR) }),
    item({ id: "open3", title: "Wire the prompt", updatedAt: ago(4 * HOUR) }),
    item({ id: "open4", title: "Fourth item", updatedAt: ago(5 * HOUR) }),
    item({ id: "blocked", title: "Awaiting review", status: "blocked", updatedAt: ago(6 * HOUR) }),
    item({ id: "done", title: "Merged PR #11", status: "completed", completedAt: ago(7 * HOUR) }),
    item({ id: "gone", title: "Abandoned", status: "superseded", supersededAt: ago(8 * HOUR) }),
  ];

  const board = buildWorkBoard(items);

  assert.equal(board.activePriority?.id, "active");
  assert.deepEqual(board.nextOpen.map((entry) => entry.id), ["open1", "open2", "open3"]);
  assert.deepEqual(board.blocked.map((entry) => entry.id), ["blocked"]);
  assert.deepEqual(board.recentlyCompleted.map((entry) => entry.id), ["done"]);
  assert.ok(!board.nextOpen.some((entry) => entry.id === "gone"), "superseded work is never shown as next");
});

test("blocked work ranks below open work and never leads", () => {
  const ranked = rankOpenWork([
    item({ id: "blocked", title: "Blocked", status: "blocked", updatedAt: ago(1) }),
    item({ id: "open", title: "Open", updatedAt: ago(10 * HOUR) }),
  ]);
  assert.deepEqual(ranked.map((entry) => entry.id), ["open", "blocked"]);
});

// --- Evidence provenance ---------------------------------------------------

test("every item carries a citable reference and its status", () => {
  const references = buildEvidenceReferences([
    normaliseGitHubPullRequest({ number: 11, title: "Motion", state: "closed", html_url: "https://x/pull/11", created_at: ago(9 * HOUR), updated_at: ago(2 * HOUR), merged_at: ago(2 * HOUR), closed_at: ago(2 * HOUR) }, REPO),
    normaliseGitHubIssue({ number: 8, title: "Issue", state: "open", html_url: "https://x/issues/8", created_at: ago(9 * HOUR), updated_at: ago(HOUR) }, REPO),
    item({ id: "launch_backlog:abc", title: "Manual task" }),
  ]);

  assert.deepEqual(references.map((reference) => reference.label), ["PR #11", "issue #8", "launch task"]);
  assert.deepEqual(references.map((reference) => reference.status), ["completed", "open", "open"]);
  assert.ok(references.every((reference) => reference.workItemId && reference.updatedAt));
  assert.equal(references[0].url, "https://x/pull/11");
});

// --- Ingestion merge -------------------------------------------------------

test("re-ingestion overwrites source-owned state and keeps local blockedBy", () => {
  const stored = [item({ id: workItemId("github_pull_request", REPO, 12), title: "Old title", blockedBy: ["launch_backlog:x"] })];
  const ingested = [
    normaliseGitHubPullRequest(
      { number: 12, title: "New title", state: "closed", html_url: "u", created_at: ago(9 * HOUR), updated_at: ago(HOUR), merged_at: ago(HOUR), closed_at: ago(HOUR) },
      REPO,
    ),
  ];

  const merged = mergeIngested(stored, ingested);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "New title");
  assert.equal(merged[0].status, "completed", "GitHub is authoritative for its own items");
  assert.deepEqual(merged[0].blockedBy, ["launch_backlog:x"], "local links survive re-ingestion");
});

test("manual launch tasks are untouched by GitHub ingestion", () => {
  const manual = item({ id: "launch_backlog:abc", title: "Write the launch list", status: "active" });
  const merged = mergeIngested(
    [manual],
    [normaliseGitHubPullRequest({ number: 12, title: "PR", state: "open", html_url: "u", created_at: ago(HOUR), updated_at: ago(HOUR) }, REPO)],
  );

  assert.equal(merged.find((entry) => entry.id === manual.id)?.status, "active");
  assert.equal(merged.length, 2);
});
