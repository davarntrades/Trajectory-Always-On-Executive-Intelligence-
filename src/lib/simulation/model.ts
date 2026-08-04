/**
 * The forward model.
 *
 * A lightweight, mutable projection of the substrate that can be stepped
 * forward a day at a time under the five stochastic processes in
 * SIMULATION.md §3. Interventions modify this world at t=0; then dynamics run.
 *
 * Parameters here are *priors*, not learned estimates. Nothing has been
 * calibrated yet, which is why everything this produces is currently labelled
 * `uncalibrated` (SIMULATION.md §7). Step 5 of the build order replaces these
 * constants with Beta posteriors from observed outcomes.
 */

import {
  bernoulli,
  clamp01,
  normal,
  poisson,
  type Rng,
  type StreamSet,
} from "./random";
import type { Entity, Opportunity, Project, Task } from "@/lib/types";

// --- prior parameters ------------------------------------------------------

/** Per-day base hazard of advancing a stage, by stage. */
const BASE_ADVANCE: Record<string, number> = {
  discovery: 0.035,
  qualified: 0.045,
  proposal: 0.05,
  negotiation: 0.07,
};

/** Per-day base hazard of a deal dying, by stage. */
const BASE_DIE: Record<string, number> = {
  discovery: 0.02,
  qualified: 0.015,
  proposal: 0.012,
  negotiation: 0.008,
};

/** Default responsiveness when a person has no observed history. */
const DEFAULT_REPLY_MEAN_DAYS = 4;

/**
 * Hours per day available *for tracked work* — not hours awake. Most of an
 * operator's day goes to meetings, comms and unplanned work that never appears
 * as a task. Setting this too high makes the simulation complete everything and
 * strips task-ordering of any consequence.
 */
const CAPACITY_MEAN_HOURS = 2.5;
const CAPACITY_SD_HOURS = 1;

/** Unplanned work arriving per day, in hours. */
const INTERRUPT_RATE = 0.6;
const INTERRUPT_HOURS = 0.75;

/** A follow-up multiplies reply hazard by this, decaying over the window. */
const CONTACT_NUDGE = 2.4;
const CONTACT_WINDOW_DAYS = 7;

// --- world -----------------------------------------------------------------

export interface SimOpportunity {
  id: string;
  name: string;
  stage: string;
  value: number;
  /**
   * Two independent clocks, and conflating them is a modelling error.
   *
   * `daysSinceContact` is *my* responsiveness clock — contacting them resets it,
   * and it drives how live the relationship feels.
   *
   * `cycleDay` is *their* decision clock — it advances regardless of what I do.
   * Emailing someone does not rewind their procurement process.
   */
  daysSinceContact: number;
  cycleDay: number;
  expectedReplyDays: number;
  /** From the company entity, when known — the length of their decision cycle. */
  buyingCycleDays?: number;
  /**
   * Deliverable work the counterparty is waiting on before this deal can move.
   *
   * Without this coupling, tasks and deals evolve independently and clearing a
   * bottleneck can never show commercial value — which would miss the entire
   * mechanism by which internal work turns into revenue.
   */
  gatedByTaskIds: string[];
  alive: boolean;
  won: boolean;
}

export interface SimTask {
  id: string;
  title: string;
  projectId?: string;
  effortRemaining: number;
  impact: number;
  blockedBy: string[];
  done: boolean;
  dueInDays?: number;
}

export interface SimWaiting {
  taskId: string;
  personId?: string;
  /** Exponential hazard rate, per day. */
  lambda: number;
  daysWaiting: number;
  replied: boolean;
  /** Days remaining on a contact nudge, if one was applied. */
  nudgeDaysLeft: number;
}

export interface SimProject {
  id: string;
  name: string;
  valueScore: number;
  momentum: number;
  /** Poisson arrival rate of new events per day, learned per project. */
  arrivalRate: number;
}

export interface SimWorld {
  day: number;
  opportunities: SimOpportunity[];
  tasks: SimTask[];
  waiting: SimWaiting[];
  projects: SimProject[];
  /** Cumulative value of deals closed won during the simulation. */
  closedWonValue: number;
  /** Cumulative hours lost to unplanned work — the reason plans slip. */
  interruptedHours: number;
  /** Hours pre-committed by an intervention, charged against day 0 capacity. */
  committedHours: number;
  /** Tasks completed during the run, for milestone progress. */
  completedTaskIds: string[];
}

export interface WorldInput {
  tasks: Task[];
  projects: Project[];
  opportunities: Opportunity[];
  entities: Entity[];
  /** Per-project event arrival rates, derived from observed history. */
  arrivalRates: Record<string, number>;
  /** Observed momentum at t=0, so simulation starts where reality is. */
  momentum: Record<string, number>;
  /** opportunityId -> task ids that gate it. */
  gates?: Record<string, string[]>;
}

const MS_PER_DAY = 864e5;

export function buildWorld(input: WorldInput, now = Date.now()): SimWorld {
  const daysSince = (iso?: string) =>
    iso ? Math.max(0, (now - new Date(iso).getTime()) / MS_PER_DAY) : 999;

  const opportunities: SimOpportunity[] = input.opportunities
    .filter((o) => o.stage !== "closed_won" && o.stage !== "closed_lost")
    .map((o) => {
      const company = input.entities.find((e) => e.id === o.companyId);
      const cycle = Number(company?.attributes?.buyingCycleDays ?? 0);
      return {
        id: o.id,
        name: o.name,
        stage: o.stage,
        value: o.value,
        daysSinceContact: daysSince(o.lastContactAt),
        // Their cycle started when the engagement did; at t=0 the best proxy we
        // have is time since last contact, but from here the clocks diverge.
        cycleDay: daysSince(o.lastContactAt),
        expectedReplyDays: o.expectedReplyDays,
        buyingCycleDays: cycle > 0 ? cycle : undefined,
        gatedByTaskIds: input.gates?.[o.id] ?? [],
        alive: true,
        won: false,
      };
    });

  const tasks: SimTask[] = input.tasks
    .filter((t) => t.status !== "done")
    .map((t) => ({
      id: t.id,
      title: t.title,
      projectId: t.projectId,
      effortRemaining: t.effortHours,
      impact: t.impact,
      blockedBy: [...t.blockedBy],
      done: false,
      dueInDays: t.dueAt
        ? (new Date(t.dueAt).getTime() - now) / MS_PER_DAY
        : undefined,
    }));

  const waiting: SimWaiting[] = input.tasks
    .filter((t) => t.status === "waiting")
    .map((t) => {
      const person = input.entities.find((e) => e.id === t.waitingOn);
      const meanDays = Number(
        person?.attributes?.replyMeanDays ?? DEFAULT_REPLY_MEAN_DAYS,
      );
      return {
        taskId: t.id,
        personId: t.waitingOn,
        lambda: 1 / Math.max(0.5, meanDays),
        daysWaiting: daysSince(t.waitingSince),
        replied: false,
        nudgeDaysLeft: 0,
      };
    });

  const projects: SimProject[] = input.projects
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      valueScore: p.valueScore,
      momentum: input.momentum[p.id] ?? 0,
      arrivalRate: input.arrivalRates[p.id] ?? 0.15,
    }));

  return {
    day: 0,
    opportunities,
    tasks,
    projects,
    waiting,
    closedWonValue: 0,
    interruptedHours: 0,
    committedHours: 0,
    completedTaskIds: [],
  };
}

export function cloneWorld(w: SimWorld): SimWorld {
  return {
    day: w.day,
    opportunities: w.opportunities.map((o) => ({ ...o })),
    tasks: w.tasks.map((t) => ({ ...t, blockedBy: [...t.blockedBy] })),
    waiting: w.waiting.map((x) => ({ ...x })),
    projects: w.projects.map((p) => ({ ...p })),
    closedWonValue: w.closedWonValue,
    interruptedHours: w.interruptedHours,
    committedHours: w.committedHours,
    completedTaskIds: [...w.completedTaskIds],
  };
}

// --- dynamics --------------------------------------------------------------

/** Recent contact makes advance more likely; the boost decays over ~7 days. */
function contactBoost(daysSinceContact: number): number {
  return 1 + 1.2 * Math.exp(-daysSinceContact / 5);
}

/** Silence past the expected reply window raises the death hazard. */
function silenceDecay(daysSinceContact: number, expectedReplyDays: number): number {
  const overdue = daysSinceContact - expectedReplyDays;
  return overdue <= 0 ? 1 : 1 + Math.min(3, overdue / expectedReplyDays);
}

/**
 * Counterparties with a known buying cycle are most movable mid-cycle: too
 * early and the decision isn't live, too late and it's already made. This is
 * the mechanism behind "day 4 of a 10-day cycle".
 *
 * Reads `cycleDay`, never `daysSinceContact` — their decision clock runs on its
 * own regardless of whether I email them.
 */
function cyclePosition(o: SimOpportunity): number {
  if (!o.buyingCycleDays) return 1;
  const position = o.cycleDay / o.buyingCycleDays;
  if (position > 1.2) return 0.4; // decision likely already made
  // Peaks around 60% through the cycle.
  return 1 + 0.8 * Math.exp(-(((position - 0.6) / 0.35) ** 2));
}

function stepOpportunities(world: SimWorld, rng: Rng) {
  const order = ["discovery", "qualified", "proposal", "negotiation"];

  for (const o of world.opportunities) {
    if (!o.alive || o.won) {
      // Still consume a draw so the stream stays aligned across arms.
      rng();
      rng();
      continue;
    }

    // A deal waiting on deliverable work barely moves. Not zero — occasionally
    // things advance in parallel — but the gate is the dominant term.
    const gated = o.gatedByTaskIds.some(
      (id) => !world.tasks.find((t) => t.id === id)?.done,
    );

    const advance =
      (BASE_ADVANCE[o.stage] ?? 0.03) *
      contactBoost(o.daysSinceContact) *
      cyclePosition(o) *
      (gated ? 0.15 : 1);
    const die =
      (BASE_DIE[o.stage] ?? 0.015) *
      silenceDecay(o.daysSinceContact, o.expectedReplyDays);

    if (bernoulli(rng, advance)) {
      const i = order.indexOf(o.stage);
      if (i === order.length - 1) {
        o.won = true;
        o.alive = false;
        world.closedWonValue += o.value;
      } else if (i >= 0) {
        o.stage = order[i + 1];
      }
    } else if (bernoulli(rng, die)) {
      o.alive = false;
    } else {
      rng(); // keep draw count fixed per opportunity per day
    }

    o.daysSinceContact += 1;
    o.cycleDay += 1;
  }
}

function stepWaiting(world: SimWorld, rng: Rng) {
  for (const w of world.waiting) {
    if (w.replied) {
      rng();
      continue;
    }
    const nudge =
      w.nudgeDaysLeft > 0
        ? 1 + (CONTACT_NUDGE - 1) * (w.nudgeDaysLeft / CONTACT_WINDOW_DAYS)
        : 1;
    // Per-day probability from an exponential hazard.
    const p = 1 - Math.exp(-w.lambda * nudge);
    if (bernoulli(rng, p)) {
      w.replied = true;
      const task = world.tasks.find((t) => t.id === w.taskId);
      if (task) task.effortRemaining = Math.min(task.effortRemaining, 0.25);
    }
    w.daysWaiting += 1;
    if (w.nudgeDaysLeft > 0) w.nudgeDaysLeft -= 1;
  }
}

function stepCapacityAndTasks(
  world: SimWorld,
  capacityRng: Rng,
  arrivalRng: Rng,
) {
  // Available focus hours vary; a plan assuming a clear day is often wrong.
  let capacity = Math.max(0, normal(capacityRng, CAPACITY_MEAN_HOURS, CAPACITY_SD_HOURS));

  const interrupts = poisson(arrivalRng, INTERRUPT_RATE);
  const lost = interrupts * INTERRUPT_HOURS;
  capacity = Math.max(0, capacity - lost);
  world.interruptedHours += lost;

  // An intervention's cost is charged here, against real capacity, so choosing
  // one action genuinely means not spending those hours on another.
  if (world.committedHours > 0) {
    const charge = Math.min(capacity, world.committedHours);
    capacity -= charge;
    world.committedHours -= charge;
  }

  // Work unblocked tasks in impact order — a stand-in for the admissibility
  // ordering the real engine produces.
  const unblocked = world.tasks
    .filter(
      (t) =>
        !t.done &&
        t.blockedBy.every((id) => world.tasks.find((x) => x.id === id)?.done !== false),
    )
    .sort((a, b) => {
      const aDue = a.dueInDays ?? 999;
      const bDue = b.dueInDays ?? 999;
      if (aDue !== bDue) return aDue - bDue;
      return b.impact - a.impact;
    });

  for (const task of unblocked) {
    if (capacity <= 0) break;
    const spend = Math.min(capacity, task.effortRemaining);
    task.effortRemaining -= spend;
    capacity -= spend;
    if (task.effortRemaining <= 1e-6) {
      task.done = true;
      world.completedTaskIds.push(task.id);
    }
  }

  for (const t of world.tasks) {
    if (t.dueInDays !== undefined) t.dueInDays -= 1;
  }
}

function stepMomentum(world: SimWorld, rng: Rng) {
  const decay = Math.exp(-Math.LN2 / 7);
  for (const p of world.projects) {
    const arrivals = poisson(rng, p.arrivalRate);
    p.momentum = p.momentum * decay + arrivals * 1.5;
  }
}

/** Advance the world one day under all five processes. */
export function step(world: SimWorld, streams: StreamSet) {
  stepOpportunities(world, streams.get("opportunity"));
  stepWaiting(world, streams.get("reply"));
  stepCapacityAndTasks(world, streams.get("capacity"), streams.get("arrival"));
  stepMomentum(world, streams.get("momentum"));
  world.day += 1;
}

export function run(world: SimWorld, days: number, streams: StreamSet): SimWorld {
  for (let d = 0; d < days; d++) step(world, streams);
  return world;
}

// --- interventions ---------------------------------------------------------

export type InterventionKind =
  | "none"
  | "contact_opportunity"
  | "complete_task"
  | "chase_person";

export interface Intervention {
  kind: InterventionKind;
  targetId?: string;
  /**
   * The engine candidate this came from.
   *
   * Distinct from `targetId` because a task-shaped candidate can be routed to
   * an opportunity-shaped intervention. Callers match results back to the
   * recommended action by this, not by target.
   */
  candidateId?: string;
  label: string;
  /** Hours consumed at t=0 — this is what makes arms genuinely exclusive. */
  effortHours: number;
  /** Days of delay before the action is taken. Used for decay curves. */
  delayDays?: number;
}

export const NO_ACTION: Intervention = {
  kind: "none",
  label: "Do nothing",
  effortHours: 0,
};

/**
 * Apply `do(a)` to the world.
 *
 * Capacity is charged immediately: taking this action means not spending those
 * hours on something else, inside the simulation. That is what turns the
 * comparison into a real opportunity-cost comparison rather than an assumption.
 */
export function intervene(world: SimWorld, action: Intervention) {
  switch (action.kind) {
    case "none":
      return;

    case "contact_opportunity": {
      const opp = world.opportunities.find((o) => o.id === action.targetId);
      if (opp && opp.alive) opp.daysSinceContact = 0;
      break;
    }

    case "chase_person": {
      const w = world.waiting.find(
        (x) => x.taskId === action.targetId || x.personId === action.targetId,
      );
      if (w && !w.replied) {
        w.nudgeDaysLeft = CONTACT_WINDOW_DAYS;
        w.daysWaiting = 0;
      }
      // Chasing a counterparty also counts as contact on their open deal.
      const opp = world.opportunities.find((o) => o.id === action.targetId);
      if (opp && opp.alive) opp.daysSinceContact = 0;
      break;
    }

    case "complete_task": {
      const task = world.tasks.find((t) => t.id === action.targetId);
      if (task && !task.done) {
        task.done = true;
        task.effortRemaining = 0;
        world.completedTaskIds.push(task.id);
      }
      break;
    }
  }

  // Charge the cost explicitly against upcoming capacity.
  world.committedHours += action.effortHours;
}

export { clamp01 };
