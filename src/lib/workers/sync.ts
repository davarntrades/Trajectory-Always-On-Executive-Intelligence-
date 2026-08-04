/**
 * Sync worker.
 *
 * Pulls from every configured connector, normalises into events, appends them,
 * and recomputes state. In Phase 1 this is invoked via `POST /api/sync`; in
 * Phase 3 the same function runs on a queue with retries and backoff, triggered
 * by webhooks as well as a schedule. The body of the work does not change — only
 * what calls it.
 */

import { configuredConnectors } from "@/lib/connectors";
import { computeState } from "@/lib/state/compute";
import { getStore } from "@/lib/store";
import type { TrajectoryState } from "@/lib/types";

export interface SyncReport {
  ranAt: string;
  connectors: {
    id: string;
    status: "ok" | "error" | "skipped";
    eventsPulled: number;
    eventsNew: number;
    error?: string;
  }[];
  totalNewEvents: number;
  state?: TrajectoryState;
}

export async function runSync(options: { recompute?: boolean } = {}): Promise<SyncReport> {
  const { recompute = true } = options;
  const store = getStore();
  const connectors = configuredConnectors();

  const report: SyncReport = {
    ranAt: new Date().toISOString(),
    connectors: [],
    totalNewEvents: 0,
  };

  for (const connector of connectors) {
    try {
      const result = await connector.sync({ ownerId: "self" });
      const added = await store.appendEvents(result.events);

      report.connectors.push({
        id: connector.id,
        status: "ok",
        eventsPulled: result.events.length,
        eventsNew: added,
      });
      report.totalNewEvents += added;

      await store.appendAudit({
        at: new Date().toISOString(),
        actor: connector.id,
        event: "sync",
        tier: "observe",
        detail: { pulled: result.events.length, added },
      });
    } catch (err) {
      // One bad connector must not stop the others.
      report.connectors.push({
        id: connector.id,
        status: "error",
        eventsPulled: 0,
        eventsNew: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Recompute only when something actually changed, or when forced.
  if (recompute && (report.totalNewEvents > 0 || connectors.length === 0)) {
    report.state = await computeState({ persist: true });
  }

  return report;
}
