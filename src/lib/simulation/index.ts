/**
 * Simulation orchestration.
 *
 * Pulls substrate, runs the deterministic engine to get the admissible ranking,
 * funnels to the top K (SIMULATION.md §9 — leverage is demoted to a prior that
 * decides what is worth simulating), then prices each candidate against a
 * do-nothing baseline.
 */

import { runEngine } from "@/lib/state/engine";
import { getStore } from "@/lib/store";
import type { ScoredCandidate } from "@/lib/types";
import type { Intervention } from "./model";
import { simulate, type SimulationOptions, type SimulationReport } from "./run";

export * from "./run";
export type { Intervention, SimWorld } from "./model";

/** Map an engine candidate onto a simulator intervention. */
function toIntervention(c: ScoredCandidate): Intervention | null {
  if (c.kind === "opportunity") {
    return {
      kind: "contact_opportunity",
      targetId: c.id,
      label: c.title,
      effortHours: c.effortHours,
    };
  }
  if (c.kind === "task" || c.kind === "unblock") {
    return {
      kind: "complete_task",
      targetId: c.id,
      label: c.title,
      effortHours: c.effortHours,
    };
  }
  return null;
}

export interface RunSimulationOptions extends SimulationOptions {
  /** How many top-ranked candidates to price. */
  topK?: number;
}

export async function runSimulation(
  options: RunSimulationOptions = {},
): Promise<SimulationReport> {
  const { topK = 4, ...simOptions } = options;
  const store = getStore();

  const [projects, tasks, opportunities, events, entities, goals] =
    await Promise.all([
      store.projects(),
      store.tasks(),
      store.opportunities(),
      store.events(30),
      store.entities(),
      store.goals(),
    ]);

  const engine = runEngine({ projects, tasks, opportunities, events, entities });

  // Observed event arrival rate per project, used as the Poisson rate forward.
  const arrivalRates: Record<string, number> = {};
  for (const p of projects) {
    const count = events.filter((e) => e.projectId === p.id).length;
    arrivalRates[p.id] = Math.max(0.05, count / 30);
  }

  // Start simulated momentum where observed momentum actually is.
  const momentum: Record<string, number> = {};
  for (const m of engine.signals.projectMomentum) {
    momentum[m.projectId] = m.score;
  }

  const projectIdsByGoal = new Map<string, string[]>();
  for (const p of projects) {
    if (!p.goalId) continue;
    projectIdsByGoal.set(p.goalId, [...(projectIdsByGoal.get(p.goalId) ?? []), p.id]);
  }

  const tasksByProject = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.projectId) continue;
    tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t.id]);
  }

  /**
   * Link deals to the internal work that gates them.
   *
   * An opportunity is matched to a project through their shared company entity,
   * and the gating tasks are that project's open tasks which other tasks depend
   * on — i.e. the ones actually holding things up.
   */
  const gates: Record<string, string[]> = {};
  for (const opp of opportunities) {
    const company = entities.find((e) => e.id === opp.companyId);
    if (!company) continue;

    const names = [company.name, ...company.aliases].map((n) => n.toLowerCase());
    const linked = projects.filter((p) =>
      names.some((n) => p.name.toLowerCase().includes(n.split(" ")[0])),
    );
    if (!linked.length) continue;

    const linkedIds = new Set(linked.map((p) => p.id));
    const blockers = tasks.filter(
      (t) =>
        t.projectId &&
        linkedIds.has(t.projectId) &&
        t.status !== "done" &&
        tasks.some((other) => other.blockedBy.includes(t.id)),
    );
    if (blockers.length) gates[opp.id] = blockers.map((t) => t.id);
  }

  const candidates = engine.signals.candidates
    .slice(0, topK)
    .map(toIntervention)
    .filter((c): c is Intervention => c !== null);

  return simulate(
    {
      tasks,
      projects,
      opportunities,
      entities,
      goals,
      arrivalRates,
      momentum,
      gates,
      candidates,
      projectIdsByGoal,
      tasksByProject,
    },
    simOptions,
  );
}
