import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEvidenceReferences,
  buildWorkBoard,
  evidenceLabel,
  mergeIngested,
  normaliseGitHubIssue,
  normaliseGitHubPullRequest,
  type GitHubPullRequestPayload,
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

test("an open pull request is open, and so is a draft", () => {
  const open = normaliseGitHubPullRequest(
    { number: 12, title: "Live open-work ingestion", state: "open", html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );
  const draft = normaliseGitHubPullRequest(
    { number: 13, title: "Spike", state: "open", draft: true, html_url: "u", created_at: ago(3 * HOUR), updated_at: ago(HOUR) },
    REPO,
  );

  assert.equal(open.status, "open");
  assert.equal(open.draft, undefined, "a ready pull request carries no draft flag");
  assert.equal(draft.status, "open", "a draft is unfinished, not obstructed");
  assert.equal(draft.draft, true, "draft-ness is recorded beside the status, not inside it");
  assert.equal(isRecommendable(open), true);
  assert.equal(isRecommendable(draft), true);
});

// --- Draft is not an obstruction (issue #13) -------------------------------

const draftPull = (overrides: Partial<GitHubPullRequestPayload> = {}) =>
  normaliseGitHubPullRequest(
    {
      number: 14,
      title: "Draft in progress",
      state: "open",
      draft: true,
      html_url: "u",
      created_at: ago(3 * HOUR),
      updated_at: ago(HOUR),
      ...overrides,
    },
    REPO,
  );

test("a draft with a blocked label is blocked, and still marked draft", () => {
  const item = draftPull({ labels: [{ name: "blocked" }] });
  assert.equal(item.status, "blocked", "a recorded obstruction still blocks");
  assert.equal(item.draft, true, "the two facts are independent");
});

test("a merged draft is completed and carries no draft flag", () => {
  const item = draftPull({ state: "closed", merged_at: ago(HOUR), closed_at: ago(HOUR) });
  assert.equal(item.status, "completed");
  assert.equal(item.completedAt, ago(HOUR));
  assert.equal(item.draft, undefined, "finished work cannot also be in progress");
});

test("a draft closed without merging is superseded and carries no draft flag", () => {
  const item = draftPull({ state: "closed", closed_at: ago(HOUR) });
  assert.equal(item.status, "superseded");
  assert.ok(item.supersededAt);
  assert.equal(item.draft, undefined);
  assert.equal(isRecommendable(item), false);
});

test("a local blocker obstructs an open item; clearing it releases the item", () => {
  const stored = [item({ id: workItemId("github_pull_request", REPO, 14), title: "Draft", blockedBy: ["launch_backlog:x"] })];

  const blocked = mergeIngested(stored, [draftPull()]);
  assert.equal(blocked[0].status, "blocked", "a recorded local blocker is real obstruction");
  assert.equal(blocked[0].draft, true);

  const released = mergeIngested(
    [{ ...blocked[0], blockedBy: [] }],
    [draftPull()],
  );
  assert.equal(released[0].status, "open", "removing the last blocker returns it to open work");
  assert.equal(released[0].draft, true, "it is still unfinished, just no longer obstructed");
});

test("re-ingesting a draft preserves the corrected state", () => {
  const first = mergeIngested([], [draftPull()]);
  const second = mergeIngested(first, [draftPull()]);

  assert.equal(second.length, 1, "re-ingestion does not duplicate");
  assert.equal(second[0].id, first[0].id, "canonical ids remain stable");
  assert.equal(second[0].status, "open", "the corrected status does not drift back to blocked");
  assert.equal(second[0].draft, true);
});

test("a draft can be recommended, and appears in open work rather than blocked", () => {
  const board = buildWorkBoard([draftPull()]);
  assert.equal(board.blocked.length, 0, "no false blocker is manufactured");
  assert.equal(board.nextOpen.length, 1);
  assert.equal(board.nextOpen[0].draft, true);

  // Ranking is what decides whether a draft can lead. It must not be pushed
  // behind other work merely for being unfinished.
  const ranked = rankOpenWork([
    item({ id: "launch_backlog:other", title: "Something else", updatedAt: ago(4 * HOUR) }),
    draftPull(),
  ]);
  assert.equal(ranked[0].draft, true, "a draft can be the highest-ranked open item");
});

test("draft state reaches the assembled evidence as unfinished, not obstructed", () => {
  const evidence = buildStateEvidence({
    trajectory: "steady",
    riskLevel: "low",
    eventsLast24h: 0,
    openWork: [
      { title: "Draft in progress", kind: "open", reference: "PR #14", draft: true, updatedAt: ago(HOUR) },
      { title: "Genuinely stuck", kind: "blocked", reference: "issue #9", updatedAt: ago(2 * HOUR) },
    ],
    transcript: "What should I focus on now?",
    now: NOW,
  });

  assert.match(evidence, /PR #14\] \(open, draft — still being written/);
  assert.match(evidence, /unfinished, not obstructed/);
  assert.match(evidence, /never recommend naming one for it/);
  assert.match(evidence, /a draft can still be the highest-leverage thing/);
  assert.ok(
    !/Draft in progress.*blocked/.test(evidence),
    "the draft must never be described as blocked",
  );
});

test("the status vocabulary is omitted when nothing is draft or blocked", () => {
  // Prompt weight is not free. The explanation is only worth its tokens when
  // there is something in the list it could be misread against.
  const evidence = buildStateEvidence({
    trajectory: "steady",
    riskLevel: "low",
    eventsLast24h: 0,
    openWork: [{ title: "Ordinary work", kind: "open", reference: "issue #8", updatedAt: ago(HOUR) }],
    transcript: "What should I focus on now?",
    now: NOW,
  });

  assert.ok(!/How to read those statuses/.test(evidence));
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

// --- Idempotency against the repository's real payload shape ---------------

/**
 * The eleven pull requests and one issue that existed at live acceptance,
 * with the fields ingestion actually reads. Note `merged: false` alongside a
 * populated `merged_at`: the list endpoint really does report it that way, so
 * normalisation keys off `merged_at` and this fixture preserves the trap.
 */
const LIVE_PULLS = [
  { number: 12, title: "Live open-work ingestion and launch backlog", state: "open", draft: true, created_at: "2026-08-06T15:21:02Z", updated_at: "2026-08-06T17:56:09Z" },
  { number: 11, title: "Wire cinematic motion into the live Trajectory experience", state: "closed", merged_at: "2026-08-06T14:54:42Z", closed_at: "2026-08-06T14:54:42Z", created_at: "2026-08-06T12:59:34Z", updated_at: "2026-08-06T14:54:42Z" },
  { number: 10, title: "Sync latest Trajectory motion work into main", state: "closed", merged_at: "2026-08-06T03:16:16Z", closed_at: "2026-08-06T03:16:16Z", created_at: "2026-08-06T03:16:06Z", updated_at: "2026-08-06T03:16:16Z" },
  { number: 9, title: "Start cinematic motion foundation", state: "closed", merged_at: "2026-08-06T03:11:56Z", closed_at: "2026-08-06T03:11:56Z", created_at: "2026-08-06T02:51:16Z", updated_at: "2026-08-06T03:11:56Z" },
  { number: 7, title: "Repair voice pipeline and add personalization check-ins", state: "closed", merged_at: "2026-08-06T02:41:34Z", closed_at: "2026-08-06T02:41:34Z", created_at: "2026-08-05T18:46:30Z", updated_at: "2026-08-06T02:41:34Z" },
  { number: 6, title: "Global Trajectory language and motion system", state: "closed", merged_at: "2026-08-05T18:34:20Z", closed_at: "2026-08-05T18:34:20Z", created_at: "2026-08-05T17:34:32Z", updated_at: "2026-08-05T18:34:20Z" },
  { number: 5, title: "Record production authentication verification", state: "closed", merged_at: "2026-08-04T23:48:55Z", closed_at: "2026-08-04T23:48:55Z", created_at: "2026-08-04T23:48:27Z", updated_at: "2026-08-04T23:48:55Z" },
  { number: 4, title: "Activate production Supabase workspaces", state: "closed", merged_at: "2026-08-04T23:43:00Z", closed_at: "2026-08-04T23:43:00Z", created_at: "2026-08-04T23:41:11Z", updated_at: "2026-08-04T23:43:00Z" },
  { number: 3, title: "Build the multi-user Trajectory SaaS foundation", state: "closed", merged_at: "2026-08-04T22:54:42Z", closed_at: "2026-08-04T22:54:42Z", created_at: "2026-08-04T22:53:11Z", updated_at: "2026-08-04T22:54:42Z" },
  { number: 2, title: "Add OpenAI as a selectable intelligence provider", state: "closed", merged_at: "2026-08-04T22:14:53Z", closed_at: "2026-08-04T22:14:53Z", created_at: "2026-08-04T22:14:30Z", updated_at: "2026-08-04T22:14:53Z" },
  { number: 1, title: "Prepare Trajectory for production deployment", state: "closed", merged_at: "2026-08-04T21:28:49Z", closed_at: "2026-08-04T21:28:49Z", created_at: "2026-08-04T21:27:56Z", updated_at: "2026-08-04T21:28:49Z" },
].map((pull) => ({ ...pull, html_url: `https://github.com/${REPO}/pull/${pull.number}` }));

const LIVE_ISSUES = [
  {
    number: 8,
    title: "Trajectory — Cinematic Motion System & Visual Identity",
    state: "open",
    html_url: `https://github.com/${REPO}/issues/8`,
    created_at: "2026-08-06T02:46:56Z",
    updated_at: "2026-08-06T02:46:56Z",
  },
];

const ingestLive = () => [
  ...LIVE_ISSUES.map((issue) => normaliseGitHubIssue(issue, REPO)),
  ...LIVE_PULLS.map((pull) => normaliseGitHubPullRequest(pull, REPO)),
];

test("the live payload set resolves to the statuses observed in production", () => {
  const tally = ingestLive().reduce<Record<string, number>>(
    (counts, entry) => ({ ...counts, [entry.status]: (counts[entry.status] ?? 0) + 1 }),
    {},
  );

  // Before issue #13 this set produced { completed: 10, blocked: 1, open: 1 },
  // the blocked item being draft PR #12 — the false blocker that made the
  // Executive Signal ask for a cause that never existed. The same twelve
  // payloads now produce two open items and nothing blocked.
  assert.deepEqual(tally, { completed: 10, open: 2 });

  const twelve = ingestLive().find(
    (entry) => entry.source === "github_pull_request" && entry.externalRef?.number === 12,
  );
  assert.equal(twelve?.status, "open", "a draft is open work");
  assert.equal(twelve?.draft, true, "and is still recorded as unfinished");
});

test("re-ingesting the same GitHub state does not create duplicate records", () => {
  // This is the pure-logic half of the second-sync proof. The other half is
  // the database: canonical_id is deterministic and (user_id, canonical_id)
  // is unique, so an upsert on the same set rewrites rows rather than adding.
  const first = mergeIngested([], ingestLive());
  const second = mergeIngested(first, ingestLive());

  assert.equal(first.length, 12);
  assert.equal(second.length, 12, "a second sync must not grow the record set");
  assert.deepEqual(
    second.map((entry) => entry.id).sort(),
    first.map((entry) => entry.id).sort(),
    "canonical ids are stable across runs",
  );
  assert.equal(new Set(second.map((entry) => entry.id)).size, 12, "every canonical id is distinct");
});

test("every completed live record carries a completion timestamp, and only those", () => {
  for (const entry of ingestLive()) {
    if (entry.status === "completed") {
      assert.ok(entry.completedAt, `${entry.id} is completed and must carry completedAt`);
    } else {
      assert.equal(entry.completedAt, undefined, `${entry.id} is ${entry.status} and must not carry completedAt`);
    }
    assert.ok(entry.externalRef?.url, `${entry.id} must carry provenance`);
    assert.equal(entry.externalRef?.repository, REPO);
  }
});

test("PR #11 records the merge time GitHub reported, not the ingestion time", () => {
  const eleven = ingestLive().find((entry) => entry.externalRef?.number === 11 && entry.source === "github_pull_request");
  assert.equal(eleven?.status, "completed");
  assert.equal(eleven?.completedAt, "2026-08-06T14:54:42Z");
});
