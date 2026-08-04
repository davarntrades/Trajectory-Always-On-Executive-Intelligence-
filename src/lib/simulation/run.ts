/**
 * Monte Carlo runner.
 *
 * Runs the baseline arm and every candidate arm over the same random draws
 * (common random numbers), so differences between arms are attributable to the
 * intervention rather than to sampling noise. That variance reduction is what
 * lets N sit in the low hundreds instead of the tens of thousands.
 */

import { StreamSet, hashSeed, summarise, type Summary } from "./random";
import {
  buildWorld,
  cloneWorld,
  intervene,
  NO_ACTION,
  run as runDays,
  type Intervention,
  type SimWorld,
  type WorldInput,
} from "./model";
import {
  buildObjectiveSpecs,
  evaluate,
  type ObjectiveSpec,
  type ValueOptions,
} from "./value";
import type { Goal } from "@/lib/types";

export type CalibrationStatus = "calibrated" | "provisional" | "uncalibrated";

export interface ObjectiveShift {
  objectiveId: string;
  label: string;
  /** P(on track) with no action. */
  baseline: number;
  /** P(on track) with this action. */
  withAction: number;
}

export interface SimulatedRecommendation {
  actionId?: string;
  label: string;
  horizonDays: number;

  expectedDelta: number;
  interval: [number, number];
  /**
   * Share of paired trajectories where this action beat / lost to doing
   * nothing, and where it made no difference at all.
   *
   * Ties matter and must be reported separately: with common random numbers most
   * trajectories are identical between arms (the deal neither advances nor dies
   * either way), so folding ties into "did not improve" understates every
   * action. `probabilityOfImprovement` is therefore conditional on the action
   * mattering at all.
   */
  probabilityOfImprovement: number;
  probabilityOfHarm: number;
  probabilityNoEffect: number;
  downside: number;
  score: number;

  /**
   * Monte Carlo standard error of `expectedDelta`, and the number of
   * trajectories that were not ties.
   *
   * These matter more here than in typical MC work: the value signal is driven
   * by rare discrete events (a deal closing), so most paired trajectories are
   * identical and the *effective* sample is far smaller than N. Reporting the
   * error makes that visible instead of leaving a wandering estimate to be
   * discovered. If `standardError` is comparable to `expectedDelta`, the
   * magnitude is noise and only the ordering means anything.
   */
  standardError: number;
  effectiveSamples: number;

  objectiveShifts: ObjectiveShift[];
  /** Value of taking the same action after N days of delay. */
  decay: { days: number; expectedDelta: number }[];

  calibration: { status: CalibrationStatus; observations: number };
  mechanism: string;
}

export interface SimulationReport {
  seed: number;
  trajectories: number;
  horizonDays: number;
  baseline: Summary;
  baselineOnTrack: Record<string, number>;
  recommendations: SimulatedRecommendation[];
  /** Honest header — no prediction here has been resolved against reality yet. */
  calibration: { status: CalibrationStatus; resolvedPredictions: number; note: string };
  computeMs: number;
}

export interface SimulationOptions {
  trajectories?: number;
  horizonDays?: number;
  /** Weight on downside (CVaR) in the ranking score. */
  riskPenalty?: number;
  value?: ValueOptions;
  /** Delays to price for the decay curve. */
  decayDays?: number[];
  seed?: number;
}

interface ArmResult {
  values: number[];
  onTrack: Record<string, number>;
}

/**
 * Run one arm: N trajectories, each with the intervention applied at t=0 (after
 * `delayDays` of undisturbed evolution) and then dynamics to the horizon.
 */
function runArm(
  base: SimWorld,
  specs: ObjectiveSpec[],
  action: Intervention,
  opts: {
    seed: number;
    trajectories: number;
    horizonDays: number;
    value: ValueOptions;
  },
): ArmResult {
  const values: number[] = [];
  const onTrackCounts: Record<string, number> = {};
  for (const s of specs) onTrackCounts[s.id] = 0;

  const delay = action.delayDays ?? 0;

  for (let i = 0; i < opts.trajectories; i++) {
    // Same trajectory index across arms ⇒ same draws ⇒ paired comparison.
    const streams = new StreamSet(opts.seed, i);
    const world = cloneWorld(base);

    if (delay > 0) runDays(world, Math.min(delay, opts.horizonDays), streams);
    intervene(world, action);
    runDays(world, Math.max(0, opts.horizonDays - delay), streams);

    const result = evaluate(world, specs, opts.value);
    values.push(result.total);

    for (const spec of specs) {
      if (spec.onTrack(world)) onTrackCounts[spec.id] += 1;
    }
  }

  const onTrack: Record<string, number> = {};
  for (const s of specs) onTrack[s.id] = onTrackCounts[s.id] / opts.trajectories;

  return { values, onTrack };
}

export interface SimulateInput extends WorldInput {
  goals: Goal[];
  /** Candidate interventions to price, already filtered to the admissible top K. */
  candidates: Intervention[];
  /** goalId -> projectIds, for milestone objectives. */
  projectIdsByGoal: Map<string, string[]>;
  /** projectId -> taskIds. */
  tasksByProject: Map<string, string[]>;
}

export function simulate(
  input: SimulateInput,
  options: SimulationOptions = {},
): SimulationReport {
  const started = Date.now();

  const {
    trajectories = 200,
    horizonDays = 21,
    riskPenalty = 0.5,
    value = {},
    decayDays = [2, 5],
    // Seed is derived, not random: the same substrate replays identically.
    seed = hashSeed("trajectory", horizonDays, input.opportunities.length),
  } = options;

  const base = buildWorld(input);
  const specs = buildObjectiveSpecs(
    input.goals,
    input.tasksByProject,
    input.projectIdsByGoal,
    horizonDays,
  );

  const armOpts = { seed, trajectories, horizonDays, value };

  // Baseline: do nothing. Every candidate is measured against this.
  const baseline = runArm(base, specs, NO_ACTION, armOpts);
  const baselineSummary = summarise(baseline.values);

  const recommendations: SimulatedRecommendation[] = input.candidates.map(
    (candidate) => {
      const arm = runArm(base, specs, candidate, armOpts);

      // Paired deltas — trajectory i under action vs trajectory i under nothing.
      const deltas = arm.values.map((v, i) => v - baseline.values[i]);
      const summary = summarise(deltas);

      const EPS = 1e-9;
      const better = deltas.filter((d) => d > EPS).length;
      const worse = deltas.filter((d) => d < -EPS).length;
      const ties = deltas.length - better - worse;
      const decisive = better + worse;
      // Conditional on the action mattering; 0 when it never does.
      const improved = decisive > 0 ? better / decisive : 0;

      // SEM over all trajectories; ties contribute zero variance but do inflate
      // n, so this is reported alongside the non-tied count.
      const mean = summary.mean;
      const variance =
        deltas.reduce((acc, d) => acc + (d - mean) ** 2, 0) /
        Math.max(1, deltas.length - 1);
      const standardError = Math.sqrt(variance / deltas.length);

      const objectiveShifts: ObjectiveShift[] = specs.map((s) => ({
        objectiveId: s.id,
        label: s.label,
        baseline: baseline.onTrack[s.id],
        withAction: arm.onTrack[s.id],
      }));

      const decay = decayDays.map((days) => {
        const delayed = runArm(
          base,
          specs,
          { ...candidate, delayDays: days },
          armOpts,
        );
        const delayedDeltas = delayed.values.map((v, i) => v - baseline.values[i]);
        return { days, expectedDelta: round(summarise(delayedDeltas).mean) };
      });

      return {
        actionId: candidate.targetId,
        label: candidate.label,
        horizonDays,
        expectedDelta: round(summary.mean),
        interval: [round(summary.p10), round(summary.p90)],
        probabilityOfImprovement: round(improved),
        probabilityOfHarm: round(decisive > 0 ? worse / decisive : 0),
        probabilityNoEffect: round(ties / deltas.length),
        downside: round(summary.cvar10),
        standardError: round(standardError),
        effectiveSamples: decisive,
        // CVaR10 is the mean of the worst decile of ΔV, so it is negative when
        // the tail is bad. Adding κ·CVaR therefore *subtracts* value from
        // actions that can go badly wrong — which is the intent. Subtracting it
        // would reward a fat left tail.
        score: round(summary.mean + riskPenalty * Math.min(0, summary.cvar10)),
        objectiveShifts: objectiveShifts.map((o) => ({
          ...o,
          baseline: round(o.baseline),
          withAction: round(o.withAction),
        })),
        decay,
        // No prediction has been resolved yet, so nothing here is calibrated.
        calibration: { status: "uncalibrated", observations: 0 },
        mechanism: describeMechanism(candidate),
      };
    },
  );

  recommendations.sort((a, b) => b.score - a.score);

  const baselineOnTrack: Record<string, number> = {};
  for (const s of specs) baselineOnTrack[s.label] = round(baseline.onTrack[s.id]);

  return {
    seed,
    trajectories,
    horizonDays,
    baseline: {
      mean: round(baselineSummary.mean),
      p10: round(baselineSummary.p10),
      p50: round(baselineSummary.p50),
      p90: round(baselineSummary.p90),
      cvar10: round(baselineSummary.cvar10),
    },
    baselineOnTrack,
    recommendations,
    calibration: {
      status: "uncalibrated",
      resolvedPredictions: 0,
      note:
        "No predictions have been scored against outcomes yet. Treat magnitudes as " +
        "relative ordering only, not as probabilities you can bank. See SIMULATION.md §7.",
    },
    computeMs: Date.now() - started,
  };
}

function describeMechanism(action: Intervention): string {
  switch (action.kind) {
    case "contact_opportunity":
      return "Resets days-since-contact, which raises the stage-advance hazard and suppresses the silence-driven death hazard for about a week.";
    case "chase_person":
      return "Multiplies the reply hazard for this counterparty over a 7-day window and resets their contact clock.";
    case "complete_task":
      return "Removes the task and unblocks its dependents, letting downstream work draw capacity earlier.";
    default:
      return "No intervention.";
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
