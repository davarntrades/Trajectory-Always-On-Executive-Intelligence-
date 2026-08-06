/**
 * The canonical work-item schema.
 *
 * Trajectory previously had no representation of "what is still open". The
 * state engine inferred candidates from seed tasks, and the voice pipeline had
 * nothing authoritative to prioritise against, which is how completed work
 * became the only material available to recommend. A work item is the single
 * record of a unit of launch work, whether a person typed it or it came from
 * GitHub, with an explicit status and the timestamps needed to prove that
 * status is current.
 *
 * This module is deliberately free of imports so the canonical rules can be
 * asserted directly.
 */

/**
 * The five statuses. `completed` and `superseded` are terminal for the purpose
 * of recommendation: neither may ever be offered as something to do next.
 */
export const workItemStatuses = ["open", "active", "blocked", "completed", "superseded"] as const;
export type WorkItemStatus = (typeof workItemStatuses)[number];

export const workItemSources = ["launch_backlog", "github_issue", "github_pull_request"] as const;
export type WorkItemSource = (typeof workItemSources)[number];

/** Where an ingested item came from, so a recommendation can cite it. */
export interface ExternalReference {
  repository: string;
  number: number;
  url: string;
}

export interface WorkItem {
  id: string;
  title: string;
  detail?: string;
  status: WorkItemStatus;
  source: WorkItemSource;
  externalRef?: ExternalReference;
  /** Ids of items that must complete before this one can start. */
  blockedBy: string[];
  createdAt: string;
  /** Last time anything about this item changed, at the source of truth. */
  updatedAt: string;
  /** Set when, and only when, status became `completed`. */
  completedAt?: string;
  /** Set when a newer item replaced this one. */
  supersededAt?: string;
  supersededBy?: string;
  /**
   * Set when an item that had been completed was explicitly reopened. Its
   * presence is what allows a closed issue or merged pull request back into
   * the open set.
   */
  reopenedAt?: string;
}

/**
 * A citation attached to a generated Executive Signal, so every recommendation
 * can be traced to the record that justified it.
 */
export interface EvidenceReference {
  workItemId: string;
  /** Human-readable citation, e.g. "PR #11" or "launch task". */
  label: string;
  status: WorkItemStatus;
  updatedAt: string;
  url?: string;
}

/** The four groupings the work surface renders. */
export interface WorkBoard {
  activePriority: WorkItem | null;
  nextOpen: WorkItem[];
  blocked: WorkItem[];
  recentlyCompleted: WorkItem[];
}

export const terminalStatuses: readonly WorkItemStatus[] = ["completed", "superseded"];

/** Whether an item may be offered as something to do next. */
export function isRecommendable(item: WorkItem): boolean {
  return !terminalStatuses.includes(item.status);
}

export function isWorkItemStatus(value: unknown): value is WorkItemStatus {
  return typeof value === "string" && (workItemStatuses as readonly string[]).includes(value);
}
