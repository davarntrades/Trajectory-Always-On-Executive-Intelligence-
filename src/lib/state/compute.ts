/**
 * State recomputation.
 *
 * The single entry point that turns stored data into a TrajectoryState. Called
 * by the dashboard, the voice briefing, the event ingest route, and (Phase 3)
 * the background worker on a schedule. There is one state object; every surface
 * reads it, which is why voice and dashboard can never disagree.
 */

import { retrieveMemory, standingContext } from "@/lib/memory";
import type { ProviderPreference } from "@/lib/providers";
import { runEngine } from "@/lib/state/engine";
import { synthesise } from "@/lib/state/reasoner";
import { getStore } from "@/lib/store";
import type { Memory, Outlook, TrajectoryState } from "@/lib/types";

export interface ComputeOptions {
  /** Persist the snapshot. Off for previews and dry runs. */
  persist?: boolean;
  /** Skip the model call even when a key is present. */
  deterministicOnly?: boolean;
  /**
   * Run the forward simulator and attach an `outlook`.
   *
   * On by default: the dashboard's headline numbers are forward-looking, and a
   * state without them can only answer "where am I", not "where am I heading".
   */
  simulate?: boolean;
  /** Trajectories per arm. Lower for cheap refreshes. */
  trajectories?: number;
  /** Provider selected for this synthesis. Defaults to automatic selection. */
  provider?: ProviderPreference;
  /** Optional spoken or typed input used to shape the provider's explanation. */
  userInput?: string;
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
    : await synthesise(engine, memories, {
        provider: options.provider,
        userInput: options.userInput,
      });

  const resolved = narrative ?? {
    todaysObjective: engine.todaysObjective,
    reasoning: "",
    recommendedAction: undefined,
    model: undefined,
  };

  const outlook = options.simulate === false
    ? undefined
    : await buildOutlook(engine.signals.candidates[0]?.id, options.trajectories);

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
    outlook,
    provider: resolved.provider,
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

/**
 * Run the simulator and reduce it to the forward-looking numbers the interfaces
 * need.
 *
 * Failure is non-fatal: a state without an outlook is degraded, not broken, and
 * the dashboard falls back to present-tense signals.
 */
async function buildOutlook(
  topCandidateId: string | undefined,
  trajectories = 400,
): Promise<Outlook | undefined> {
  try {
    const { runSimulation } = await import("@/lib/simulation");
    const report = await runSimulation({ trajectories, horizonDays: 28, topK: 5 });

    // Match the simulated arm to the engine's chosen action where possible, so
    // the headline number describes the action actually being recommended.
    const forAction =
      report.recommendations.find((r) => r.candidateId === topCandidateId) ??
      report.recommendations[0];

    const objectiveOutlook = Object.entries(report.baselineOnTrack).map(
      ([label, onTrack]) => ({ label, onTrack }),
    );
    const primary = objectiveOutlook[0];

    // Expressed relative to the baseline trajectory value, so "+12%" means
    // twelve percent better than doing nothing — not twelve percentage points
    // of anything.
    const denominator = Math.abs(report.baseline.mean) || 1;
    const relative = forAction ? forAction.expectedDelta / denominator : 0;

    return {
      horizonDays: report.horizonDays,
      confidence: primary?.onTrack ?? 0,
      primaryObjective: primary?.label,
      expectedTrajectoryChange: relative,
      standardError: forAction ? forAction.standardError / denominator : 0,
      withinNoise: forAction
        ? Math.abs(forAction.expectedDelta) <= 2 * forAction.standardError
        : true,
      calibration: report.calibration.status,
      objectiveOutlook,
      decay: forAction?.decay ?? [],
      trajectories: report.trajectories,
      seed: report.seed,
    };
  } catch (err) {
    console.error("[trajectory] outlook unavailable:", err);
    return undefined;
  }
}
