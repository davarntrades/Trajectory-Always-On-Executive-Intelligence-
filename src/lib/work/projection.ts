/**
 * Projection of canonical work items into the engine's task vocabulary.
 *
 * Trajectory carried two records of work that never met. `tasks` drove the
 * deterministic engine — candidates, bottleneck, waiting, blocked — while
 * `work_items` carried the real, live GitHub state and reached the model only
 * as prompt text. The engine could not see the user's actual work, and the
 * backlog could not see momentum or leverage.
 *
 * This is a projection, not a second work system. Work items remain the single
 * record of live work; this maps them into the shape `runEngine` already
 * consumes so one set of deterministic rules applies to both.
 *
 * Pure and import-free by design, so the mapping can be asserted directly.
 */

import type { Task, TaskStatus } from "../types.ts";
import { type WorkItem, type WorkItemStatus } from "./types.ts";

/**
 * Placeholder weights for projected work.
 *
 * GitHub records carry no estimate of impact or effort, and inventing
 * differentiated values would put fabricated precision inside a deterministic
 * engine whose whole purpose is that its inputs can be inspected. Every
 * projected item therefore gets the same neutral weighting, which means
 * ranking *among* projected items is decided only by evidence Trajectory
 * actually holds: the blocking graph, status, and recency.
 *
 * Deriving real values — from PR size, review state, or an explicit estimate —
 * is future work, and must not be guessed at here.
 */
export const PROJECTED_IMPACT = 0.5;
export const PROJECTED_EFFORT_HOURS = 2;

/**
 * Status mapping.
 *
 * `superseded` maps to `done` rather than being dropped, and the distinction
 * matters to the dependency graph: `computeCandidates` refuses to offer a task
 * whose blockers are not `done`, so an abandoned blocker that vanished from
 * the set — or sat in any non-`done` status — would hold its dependents shut
 * forever. Terminal is terminal, however the work ended.
 */
const STATUS: Record<WorkItemStatus, TaskStatus> = {
  open: "open",
  active: "in_progress",
  blocked: "blocked",
  completed: "done",
  superseded: "done",
};

/**
 * A draft is unfinished work, not obstructed work (issue #13). It projects as
 * `in_progress` so the engine treats it as live and started, never as blocked.
 */
export function projectWorkItem(item: WorkItem): Task {
  const status = item.draft && item.status === "open" ? "in_progress" : STATUS[item.status];

  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    status,
    effortHours: PROJECTED_EFFORT_HOURS,
    impact: PROJECTED_IMPACT,
    blockedBy: item.blockedBy,
    source: item.source,
  };
}

/**
 * Projects the work set, dropping nothing: terminal items are retained because
 * the blocking graph reads them to decide whether dependents are free to move.
 */
export function workItemsAsTasks(items: WorkItem[]): Task[] {
  return items.map(projectWorkItem);
}

/**
 * Merges projected work into the stored task list.
 *
 * A work item wins over a stored task of the same id. Ids are namespaced
 * (`github_pull_request:owner/repo#14`), so a collision means the same unit of
 * work reached the engine twice and the live record is the one to trust.
 */
export function mergeTasksWithWorkItems(tasks: Task[], items: WorkItem[]): Task[] {
  const projected = workItemsAsTasks(items);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of projected) byId.set(task.id, task);
  return [...byId.values()];
}
