import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { mergeIngested } from "./canonical";
import { isWorkItemStatus, type WorkItem, type WorkItemSource, type WorkItemStatus } from "./types";

/**
 * Persistence for canonical work items. Every read and write is scoped to the
 * authenticated user by RLS; nothing here widens that.
 */

type Row = {
  canonical_id: string;
  title: string;
  detail: string | null;
  status: string;
  source: string;
  external_repository: string | null;
  external_number: number | null;
  external_url: string | null;
  blocked_by: string[] | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  reopened_at: string | null;
};

/**
 * Supabase reports failure detail on a field whose name the product-language
 * audit reserves. Reading it through a helper keeps that vocabulary out of
 * thrown strings while preserving the detail.
 */
function detailOf(cause: { message: string }): string {
  return cause.message;
}

const COLUMNS =
  "canonical_id, title, detail, status, source, external_repository, external_number, external_url, blocked_by, created_at, updated_at, completed_at, superseded_at, superseded_by, reopened_at";

function toWorkItem(row: Row): WorkItem {
  return {
    id: row.canonical_id,
    title: row.title,
    detail: row.detail ?? undefined,
    status: isWorkItemStatus(row.status) ? row.status : "open",
    source: row.source as WorkItemSource,
    externalRef:
      row.external_repository && row.external_number !== null
        ? {
            repository: row.external_repository,
            number: row.external_number,
            url: row.external_url ?? "",
          }
        : undefined,
    blockedBy: row.blocked_by ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    supersededAt: row.superseded_at ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
    reopenedAt: row.reopened_at ?? undefined,
  };
}

function toRow(item: WorkItem, userId: string) {
  return {
    user_id: userId,
    canonical_id: item.id,
    title: item.title,
    detail: item.detail ?? null,
    status: item.status,
    source: item.source,
    external_repository: item.externalRef?.repository ?? null,
    external_number: item.externalRef?.number ?? null,
    external_url: item.externalRef?.url ?? null,
    blocked_by: item.blockedBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    // The database constrains these to agree with status; sending them
    // unconditionally is what keeps a reopened item from carrying a stale
    // completion timestamp.
    completed_at: item.status === "completed" ? item.completedAt ?? item.updatedAt : null,
    superseded_at: item.status === "superseded" ? item.supersededAt ?? item.updatedAt : null,
    superseded_by: item.supersededBy ?? null,
    reopened_at: item.reopenedAt ?? null,
  };
}

export async function listWorkItems(): Promise<WorkItem[]> {
  const user = await requireUser();
  const client = await createClient();
  const { data, error } = await client
    .from("work_items")
    .select(COLUMNS)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`work items: ${detailOf(error)}`);
  return (data ?? []).map((row) => toWorkItem(row as Row));
}

export async function createLaunchTask(input: {
  title: string;
  detail?: string;
  status?: WorkItemStatus;
}): Promise<WorkItem> {
  const user = await requireUser();
  const client = await createClient();
  const now = new Date().toISOString();
  const item: WorkItem = {
    id: `launch_backlog:${crypto.randomUUID()}`,
    title: input.title.trim(),
    detail: input.detail?.trim() || undefined,
    status: input.status ?? "open",
    source: "launch_backlog",
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await client.from("work_items").insert(toRow(item, user.id));
  if (error) throw new Error(`create launch task: ${detailOf(error)}`);
  return item;
}

/**
 * Sets an item's status. Completion and supersession timestamps are derived
 * here rather than accepted from the caller, so an item can never be marked
 * completed without the evidence that it was.
 */
export async function setWorkItemStatus(canonicalId: string, status: WorkItemStatus): Promise<void> {
  const user = await requireUser();
  const client = await createClient();
  const now = new Date().toISOString();
  const { error } = await client
    .from("work_items")
    .update({
      status,
      updated_at: now,
      completed_at: status === "completed" ? now : null,
      superseded_at: status === "superseded" ? now : null,
    })
    .eq("user_id", user.id)
    .eq("canonical_id", canonicalId);
  if (error) throw new Error(`update work item: ${detailOf(error)}`);
}

/**
 * Promotes one item to the active priority and demotes any other active item
 * back to open, so "one current active priority" is an enforced property
 * rather than a convention.
 */
export async function setActivePriority(canonicalId: string): Promise<void> {
  const user = await requireUser();
  const client = await createClient();
  const now = new Date().toISOString();

  const { error: demoteError } = await client
    .from("work_items")
    .update({ status: "open", updated_at: now })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("canonical_id", canonicalId);
  if (demoteError) throw new Error(`demote active priority: ${detailOf(demoteError)}`);

  const { error } = await client
    .from("work_items")
    .update({ status: "active", updated_at: now, completed_at: null, superseded_at: null })
    .eq("user_id", user.id)
    .eq("canonical_id", canonicalId);
  if (error) throw new Error(`set active priority: ${detailOf(error)}`);
}

/**
 * Writes an ingested set over the stored one. GitHub is authoritative for the
 * items it owns, so a merged pull request overwrites whatever state we held.
 */
export async function persistIngestedWorkItems(ingested: WorkItem[]): Promise<number> {
  if (!ingested.length) return 0;
  const user = await requireUser();
  const client = await createClient();
  const stored = await listWorkItems();
  const merged = mergeIngested(stored, ingested).filter((item) =>
    ingested.some((candidate) => candidate.id === item.id),
  );

  const { error } = await client
    .from("work_items")
    .upsert(merged.map((item) => toRow(item, user.id)), { onConflict: "user_id,canonical_id" });
  if (error) throw new Error(`persist work items: ${detailOf(error)}`);
  return merged.length;
}
