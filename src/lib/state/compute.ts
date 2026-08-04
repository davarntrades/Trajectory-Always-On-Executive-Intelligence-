/**
 * State recomputation.
 *
 * The single entry point that turns stored data into a TrajectoryState. Called
 * by the dashboard, the voice briefing, the event ingest route, and (Phase 3)
 * the background worker on a schedule. There is one state object; every surface
 * reads it, which is why voice and dashboard can never disagree.
 */

import { retrieveMemory, standingContext } from "@/lib/memory";
import { runEngine } from "@/lib/state/engine";
import { synthesise } from "@/lib/state/reasoner";
import { getStore } from "@/lib/store";
import type { Memory, TrajectoryState } from "@/lib/types";

export interface ComputeOptions {
  /** Persist the snapshot. Off for previews and dry runs. */
  persist?: boolean;
  /** Skip the model call even when a key is present. */
  deterministicOnly?: boolean;
}

export async function computeState(
  options: ComputeOptions = {},
): Promise<TrajectoryState> {
  const { persist = true } = options;
  const store = getStore();

  const [projects, tasks, opportunities, events, entities] = await Promise.all([
    store.projects(),
    store.tasks(),
    store.opportunities(),
    store.events(30),
    store.entities(),
  ]);

  const engine = runEngine({ projects, tasks, opportunities, events, entities });

  // Memory relevant to *this* state, not a generic dump: query on the objective
  // and the bottleneck, plus the standing preferences and past mistakes that
  // should shape every recommendation.
  const query = [engine.todaysObjective, engine.bottleneck?.title]
    .filter(Boolean)
    .join(" ");

  const [retrieved, standing] = await Promise.all([
    retrieveMemory(query, { limit: 6 }),
    standingContext(5),
  ]);

  const memories: Memory[] = dedupeById([...standing, ...retrieved]);

  const narrative = options.deterministicOnly
    ? undefined
    : await synthesise(engine, memories);

  const resolved = narrative ?? {
    todaysObjective: engine.todaysObjective,
    reasoning: "",
    recommendedAction: undefined,
    model: undefined,
  };

  const state: TrajectoryState = {
    computedAt: new Date().toISOString(),
    trajectory: engine.trajectory,
    riskLevel: engine.riskLevel,
    commercialMomentum: engine.commercialMomentum,
    bottleneck: engine.bottleneck,
    recommendedAction: resolved.recommendedAction,
    reasoning: resolved.reasoning,
    todaysObjective: resolved.todaysObjective,
    signals: engine.signals,
    model: resolved.model,
  };

  if (persist) {
    try {
      await store.saveSnapshot(state);
    } catch (err) {
      // A snapshot write failure must not deny the user their state.
      console.error("[trajectory] snapshot persist failed:", err);
    }
  }

  return state;
}

function dedupeById(memories: Memory[]): Memory[] {
  const seen = new Set<string>();
  return memories.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}
