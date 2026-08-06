/**
 * Request-context assembly for the voice brief.
 *
 * The Executive Signal that recommended already-completed work was not
 * hard-coded anywhere: it came from this path. Recent stored messages —
 * including Trajectory's own prior reasoning — were replayed into the prompt
 * verbatim, with no timestamps, no marker separating a superseded
 * recommendation from live evidence, and no statement of which work is
 * actually still open. A recommendation the model had made hours earlier read
 * as current evidence, so it re-recommended it.
 *
 * Everything here is pure so the assembled context can be asserted directly.
 */

/**
 * One earlier turn. The caller resolves who spoke, so the persistence-layer
 * role vocabulary stays in the persistence layer.
 */
export interface ContinuityTurn {
  fromTrajectory: boolean;
  content: string;
  createdAt: string;
}

export interface OpenWorkItem {
  title: string;
  kind: string;
  /** Citation for this item, e.g. "PR #11" or "issue #8". */
  reference?: string;
  /** Whether this is the one current active priority. */
  active?: boolean;
  updatedAt?: string;
}

/**
 * Work that is finished. Naming it explicitly is stronger than omitting it:
 * the model is told what has already been delivered, so it cannot present it
 * as a next step and can say why it is not recommending it.
 */
export interface CompletedWorkItem {
  title: string;
  reference?: string;
  completedAt?: string;
}

export interface PriorSignal {
  highestLeverageRecommendation: string;
  computedAt: string;
}

export interface EvidenceInput {
  trajectory: string;
  riskLevel: string;
  bottleneck?: string;
  eventsLast24h: number;
  openWork: OpenWorkItem[];
  completedWork?: CompletedWorkItem[];
  priorSignal?: PriorSignal | null;
  transcript: string;
  now?: number;
}

export interface ContinuityInput {
  turns: ContinuityTurn[];
  checkIn?: string;
  personalisation?: string;
  now?: number;
  maxCharacters?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative age, so the model can tell live evidence from history without
 * having to reason about absolute timestamps.
 */
export function relativeAge(timestamp: string, now = Date.now()): string {
  const at = new Date(timestamp).getTime();
  if (!Number.isFinite(at)) return "age unknown";
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.round(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.round(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(elapsed / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Current state evidence. `openWork` is the action space: a recommendation
 * that does not correspond to something still open is, by definition,
 * recommending work that is already done.
 */
export function buildStateEvidence(input: EvidenceInput): string {
  const now = input.now ?? Date.now();
  const lines = [
    `Direction: ${input.trajectory}. Risk: ${input.riskLevel}.`,
    `Current bottleneck: ${input.bottleneck ?? "none recorded"}.`,
    `Recent platform activity: ${input.eventsLast24h} events in the last 24 hours.`,
  ];

  const activeItem = input.openWork.find((item) => item.active);
  lines.push(
    activeItem
      ? `Current active priority: ${activeItem.title}${activeItem.reference ? ` [${activeItem.reference}]` : ""}.`
      : "Current active priority: none has been set.",
  );

  lines.push(
    input.openWork.length
      ? `Work still open right now (this is the complete set of open items; anything not listed here is finished or not tracked). Cite the reference in square brackets when you recommend an item:\n${input.openWork
          .map((item) => {
            const reference = item.reference ? ` [${item.reference}]` : "";
            const age = item.updatedAt ? `, updated ${relativeAge(item.updatedAt, now)}` : "";
            return `- ${item.title}${reference} (${item.kind}${age})`;
          })
          .join("\n")}`
      : "Work still open right now: nothing is currently tracked as open.",
  );

  if (input.completedWork?.length) {
    lines.push(
      `Already completed and therefore not available to recommend. If the user asks about any of these, say it is done:\n${input.completedWork
        .map((item) => {
          const reference = item.reference ? ` [${item.reference}]` : "";
          const when = item.completedAt ? `, completed ${relativeAge(item.completedAt, now)}` : "";
          return `- ${item.title}${reference}${when}`;
        })
        .join("\n")}`,
    );
  }

  if (input.priorSignal) {
    lines.push(
      `Already delivered ${relativeAge(input.priorSignal.computedAt, now)} and now superseded — do not repeat it unless the open-work list above still shows it: "${input.priorSignal.highestLeverageRecommendation}"`,
    );
  }

  lines.push(`User request: ${input.transcript}`);
  return lines.join("\n");
}

/**
 * Prior turns, each stamped with its age and clearly labelled as history.
 * Trajectory's own past reasoning is marked so it is never mistaken for a
 * current observation.
 */
export function buildContinuity(input: ContinuityInput): string {
  const now = input.now ?? Date.now();
  const limit = input.maxCharacters ?? 6000;
  const sections: string[] = [];

  if (input.checkIn) sections.push(input.checkIn);
  if (input.personalisation) sections.push(input.personalisation);

  if (input.turns.length) {
    const history = input.turns
      .map((turn) => {
        const speaker = turn.fromTrajectory ? "Trajectory previously said" : "User previously said";
        return `[${relativeAge(turn.createdAt, now)}] ${speaker}: ${turn.content}`;
      })
      .join("\n")
      .slice(-limit);
    sections.push(
      `Earlier exchanges, oldest first. This is history, not current evidence: anything Trajectory recommended here has already been delivered, and may since have been completed.\n${history}`,
    );
  }

  return sections.filter(Boolean).join("\n\n");
}

/**
 * The grounding rules that keep a recommendation attached to work that is
 * actually still open.
 */
export const freshnessInstruction = `Ground the recommendation in the open-work list and the user's request. Never recommend work that the open-work list does not show as open, and never repeat a superseded recommendation unless it still appears there. Never recommend anything listed as already completed. Earlier exchanges are history: treat anything Trajectory recommended previously as already delivered. When you recommend an open item, cite its reference in square brackets exactly as given, so the recommendation can be traced to the record that justified it.`;
