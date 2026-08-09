/**
 * Canonical work-item rules.
 *
 * Two responsibilities, both of which used to be absent and both of which the
 * stale-recommendation defect depended on:
 *
 *  1. Deciding what "still open" means, once, for every source.
 *  2. Guaranteeing that completed and superseded work can never be selected as
 *     something to do next — enforced at selection, not left to the caller or
 *     to prompt wording.
 *
 * Pure by design: no imports beyond the schema, so the rules can be asserted
 * directly rather than inferred from an integration test.
 */

import {
  isRecommendable,
  type EvidenceReference,
  type WorkBoard,
  type WorkItem,
  type WorkItemStatus,
} from "./types.ts";

/** Shape of a GitHub issue, narrowed to the fields the rules depend on. */
export interface GitHubIssuePayload {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  labels?: Array<{ name: string } | string>;
  pull_request?: unknown;
}

/** Shape of a GitHub pull request, narrowed likewise. */
export interface GitHubPullRequestPayload {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  merged_at?: string | null;
  draft?: boolean;
  labels?: Array<{ name: string } | string>;
}

const BLOCKED_LABELS = new Set(["blocked", "status: blocked", "on hold"]);

function labelNames(labels: GitHubIssuePayload["labels"]): string[] {
  return (labels ?? []).map((label) => (typeof label === "string" ? label : label.name).toLowerCase());
}

/** Stable, collision-free id so re-ingesting the same item updates it. */
export function workItemId(source: string, repository: string, number: number): string {
  return `${source}:${repository}#${number}`;
}

/**
 * A closed issue is completed. The single exception is an issue GitHub marks
 * as reopened — `state` returns to `open` while `closed_at` may still be
 * populated — which is the only route back into the open set.
 */
export function normaliseGitHubIssue(payload: GitHubIssuePayload, repository: string): WorkItem {
  const reopened = payload.state === "open" && Boolean(payload.closed_at);
  const closed = payload.state === "closed";
  const labels = labelNames(payload.labels);

  let status: WorkItemStatus;
  if (closed) {
    // `not_planned` is closure without delivery: still terminal, but it was
    // superseded rather than completed, and the distinction matters when
    // explaining why something is no longer on the list.
    status = payload.state_reason === "not_planned" ? "superseded" : "completed";
  } else if (labels.some((label) => BLOCKED_LABELS.has(label))) {
    status = "blocked";
  } else {
    status = "open";
  }

  return {
    id: workItemId("github_issue", repository, payload.number),
    title: payload.title,
    detail: payload.body?.trim() ? payload.body.trim().slice(0, 2000) : undefined,
    status,
    source: "github_issue",
    externalRef: { repository, number: payload.number, url: payload.html_url },
    blockedBy: [],
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    completedAt: status === "completed" ? payload.closed_at ?? payload.updated_at : undefined,
    supersededAt: status === "superseded" ? payload.closed_at ?? payload.updated_at : undefined,
    reopenedAt: reopened ? payload.updated_at : undefined,
  };
}

/**
 * A merged pull request is completed. A pull request closed without merging is
 * superseded — the work was abandoned, not delivered — and neither may be
 * recommended again. A draft is tracked but not offered as the next action.
 */
export function normaliseGitHubPullRequest(
  payload: GitHubPullRequestPayload,
  repository: string,
): WorkItem {
  const merged = Boolean(payload.merged_at);
  const closedUnmerged = payload.state === "closed" && !merged;
  const labels = labelNames(payload.labels);

  let status: WorkItemStatus;
  if (merged) status = "completed";
  else if (closedUnmerged) status = "superseded";
  else if (payload.draft) status = "blocked";
  else if (labels.some((label) => BLOCKED_LABELS.has(label))) status = "blocked";
  else status = "open";

  return {
    id: workItemId("github_pull_request", repository, payload.number),
    title: payload.title,
    detail: payload.body?.trim() ? payload.body.trim().slice(0, 2000) : undefined,
    status,
    source: "github_pull_request",
    externalRef: { repository, number: payload.number, url: payload.html_url },
    blockedBy: [],
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    completedAt: merged ? payload.merged_at ?? payload.updated_at : undefined,
    supersededAt: closedUnmerged ? payload.closed_at ?? payload.updated_at : undefined,
  };
}

/**
 * The open-work set: everything that may legitimately be worked on next.
 * Completed and superseded items are removed here so no caller can reintroduce
 * them, and blocked items are retained because they are still live work — they
 * simply cannot start yet.
 */
export function selectOpenWork(items: WorkItem[]): WorkItem[] {
  return items.filter(isRecommendable);
}

/**
 * Exactly one active priority. If several items claim `active` the most
 * recently updated wins, so a stale claim can never outrank a current one.
 */
export function selectActivePriority(items: WorkItem[]): WorkItem | null {
  const active = items
    .filter((item) => item.status === "active" && isRecommendable(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return active[0] ?? null;
}

/** Citation label for a work item, used in evidence and in the prompt. */
export function evidenceLabel(item: WorkItem): string {
  if (item.source === "github_pull_request" && item.externalRef) return `PR #${item.externalRef.number}`;
  if (item.source === "github_issue" && item.externalRef) return `issue #${item.externalRef.number}`;
  return "launch task";
}

/**
 * Provenance for every item the signal was allowed to reason from. Terminal
 * items are included deliberately and labelled with their status: knowing that
 * PR #11 is completed is what stops it being recommended again.
 */
export function buildEvidenceReferences(items: WorkItem[]): EvidenceReference[] {
  return items.map((item) => ({
    workItemId: item.id,
    label: evidenceLabel(item),
    status: item.status,
    updatedAt: item.updatedAt,
    url: item.externalRef?.url,
  }));
}

/**
 * Ranks open work. Active first, then unblocked items by recency, then blocked
 * items — blocked work is real but cannot be started, so it never leads.
 */
export function rankOpenWork(items: WorkItem[]): WorkItem[] {
  const weight: Record<string, number> = { active: 0, open: 1, blocked: 2 };
  return selectOpenWork(items)
    .slice()
    .sort((a, b) => {
      const byStatus = (weight[a.status] ?? 3) - (weight[b.status] ?? 3);
      if (byStatus !== 0) return byStatus;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

/**
 * The four groupings the work surface renders, derived from one pass so the
 * displayed board and the prompt's open-work set can never disagree.
 */
export function buildWorkBoard(items: WorkItem[], nextCount = 3, completedCount = 3): WorkBoard {
  const activePriority = selectActivePriority(items);
  const ranked = rankOpenWork(items);

  return {
    activePriority,
    nextOpen: ranked
      .filter((item) => item.id !== activePriority?.id && item.status === "open")
      .slice(0, nextCount),
    blocked: ranked.filter((item) => item.status === "blocked"),
    recentlyCompleted: items
      .filter((item) => item.status === "completed")
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
      .slice(0, completedCount),
  };
}

/**
 * Merges a freshly ingested set over the stored one. Ingested state wins for
 * items the source owns, because the source is authoritative for them; locally
 * managed fields that GitHub knows nothing about are carried across.
 */
export function mergeIngested(stored: WorkItem[], ingested: WorkItem[]): WorkItem[] {
  const byId = new Map(stored.map((item) => [item.id, item]));
  for (const item of ingested) {
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? { ...item, blockedBy: previous.blockedBy } : item);
  }
  return [...byId.values()];
}
