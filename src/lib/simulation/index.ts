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
import type { Entity, Opportunity, ScoredCandidate } from "@/lib/types";
import type { Intervention } from "./model";
import { simulate, type SimulationOptions, type SimulationReport } from "./run";

export * from "./run";
export type { Intervention, SimWorld } from "./model";

/**
 * Map an engine candidate onto a simulator intervention.
 *
 * A task can *be* a contact action. "Follow up with Tom Aldridge" is a task in
 * the task list and a touch on Company X's deal in the pipeline — the same real
 * act recorded twice. Modelling it only as task completion makes it score zero,
 * because completing a task nothing depends on changes nothing, and the headline
 * number then reads +0% for an action that genuinely moves a deal.
 *
 * So a task naming an opportunity's contact or company is routed to the
 * contact intervention on that opportunity.
 */
function toIntervention(
  c: ScoredCandidate,
  opportunities: Opportunity[],
  entities: Entity[],
): Intervention | null {
  if (c.kind === "opportunity") {
    return {
      kind: "contact_opportunity",
      targetId: c.id,
      candidateId: c.id,
      label: c.title,
      effortHours: c.effortHours,
    };
  }

  if (c.kind !== "task" && c.kind !== "unblock") return null;

  const title = c.title.toLowerCase();
  const contactMatch = opportunities.find((o) => {
    const people = [o.contactId, o.companyId]
      .map((id) => entities.find((e) => e.id === id))
      .filter(Boolean);
    return people.some((e) =>
      [e!.name, ...e!.aliases].some((n) => title.includes(n.toLowerCase())),
    );
  });

  if (contactMatch) {
    return {
      kind: "contact_opportunity",
      targetId: contactMatch.id,
      candidateId: c.id,
      label: c.title,
      effortHours: c.effortHours,
    };
  }

  return {
    kind: "complete_task",
    targetId: c.id,
    candidateId: c.id,
    label: c.title,
    effortHours: c.effortHours,
  };
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
    .map((c) => toIntervention(c, opportunities, entities))
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
