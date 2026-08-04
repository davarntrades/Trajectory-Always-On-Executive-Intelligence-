/**
 * Notification and cadence briefs.
 *
 * Two distinct surfaces, deliberately separated:
 *
 *   - **Interrupts** are change-driven. They fire only when a delta crosses the
 *     salience threshold, because the right to break someone's focus has to be
 *     earned by being right about what matters.
 *
 *   - **Cadence briefs** (morning / midday / evening) are time-shaped digests
 *     that summarise everything accumulated since the last one. They never
 *     interrupt; they are read when opened.
 *
 * Both read the same state and the same delta, so they cannot disagree.
 */

import { config } from "@/lib/config";
import type { TrajectoryState } from "@/lib/types";
import type { Change, StateDelta } from "./delta";

export type Cadence = "morning" | "midday" | "evening";

export interface Notification {
  id: string;
  at: string;
  /** `interrupt` pushes; `digest` waits to be read. */
  channel: "interrupt" | "digest";
  cadence?: Cadence;
  title: string;
  body: string;
  salience: number;
  changeKinds: string[];
  /** Speech-shaped rendering for voice. */
  speech: string;
}

function localHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: config.timezone,
    }).format(new Date(iso)),
  );
}

export function cadenceFor(iso: string): Cadence {
  const hour = localHour(iso);
  if (hour < 11) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

const stripPunctuation = (s: string) => s.replace(/[.!?]+$/, "");
const lowerFirst = (s: string) =>
  s ? s.charAt(0).toLowerCase() + s.slice(1) : s;

/**
 * The interrupt.
 *
 * One change, stated plainly, with what to do about it. Interrupts that bundle
 * five things are ignored, so this takes the single highest-salience change and
 * attaches the current recommendation only when the decision actually moved.
 */
export function buildInterrupt(
  state: TrajectoryState,
  delta: StateDelta,
): Notification | null {
  const top = delta.changes[0];
  if (!top) return null;

  const lines: string[] = [stripPunctuation(top.summary) + "."];
  lines.push(top.why);

  // A freed window is the one case where the useful response is a suggestion
  // sized to the window, not the global top recommendation.
  if (top.kind === "window_opened") {
    const fit = pickForWindow(state, top);
    if (fit) lines.push(`I'd use it for: ${fit}.`);
  } else if (delta.decisionChanged && state.recommendedAction) {
    lines.push(
      `Highest-leverage action is now ${stripPunctuation(state.recommendedAction.title)}.`,
    );
  }

  return {
    id: crypto.randomUUID(),
    at: state.computedAt,
    channel: "interrupt",
    title: top.summary,
    body: lines.slice(1).join(" "),
    salience: top.salience,
    changeKinds: [top.kind],
    speech: lines.join(" "),
  };
}

/**
 * Best use of a freed window.
 *
 * Not simply the highest-leverage item that fits: suggesting a 30-minute email
 * for a freed 90 minutes wastes an hour of recovered deep-work time. Candidates
 * are scored by leverage weighted by how much of the window they actually use,
 * so a block gets filled by the largest worthwhile thing that fits in it.
 */
function pickForWindow(state: TrajectoryState, change: Change): string | null {
  const minutes = Number(/(\d+)\s*minutes/.exec(change.summary)?.[1] ?? 60);
  const hours = minutes / 60;

  const scored = state.signals.candidates
    .filter((c) => c.effortHours <= hours * 1.1)
    .map((c) => ({
      candidate: c,
      // Utilisation is square-rooted so it tilts the ranking without letting a
      // low-value time-filler beat a genuinely important short task.
      fit: c.leverage * Math.sqrt(Math.min(1, c.effortHours / hours)),
    }))
    .sort((a, b) => b.fit - a.fit);

  return scored[0]?.candidate.title ?? null;
}

/**
 * The cadence brief.
 *
 * Shape differs by time of day because the useful question differs: the morning
 * sets direction, midday reacts to how the day actually went, and the evening
 * closes the loop and points at tomorrow.
 */
export function buildCadenceBrief(
  state: TrajectoryState,
  delta: StateDelta,
  cadence: Cadence = cadenceFor(state.computedAt),
): Notification {
  const lines: string[] = [];
  const changes = delta.changes;

  const greetings: Record<Cadence, string> = {
    morning: `Good morning ${config.ownerName}.`,
    midday: "Quick midday check.",
    evening: "Closing out the day.",
  };
  lines.push(greetings[cadence]);

  if (cadence === "morning") {
    const meetings = state.signals.outstandingCommitments.length;
    const momentum = state.signals.projectMomentum;
    const improving = momentum.filter((m) => m.delta > 0.5);
    const cooling = momentum.filter((m) => m.status === "cooling" || m.status === "stalled");

    // Name at most two. A brief that lists every project is a report, and
    // reports get skimmed rather than heard.
    if (improving.length) {
      const named = improving
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 2)
        .map((m) => m.projectName);
      const rest = improving.length - named.length;
      const subject =
        rest > 0
          ? `${named.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`
          : listNames(named);
      lines.push(`Technical progress improved on ${subject}.`);
    }
    if (cooling.length) {
      const named = cooling.slice(0, 2).map((m) => m.projectName);
      lines.push(
        `${listNames(named)} ${named.length === 1 ? "has" : "have"} gone quiet.`,
      );
    }

    lines.push(
      state.signals.commercialDelta < -0.05
        ? "Commercial momentum has slipped."
        : state.signals.commercialDelta > 0.05
          ? "Commercial momentum is up."
          : "Commercial momentum is unchanged.",
    );

    if (meetings) {
      lines.push(`${meetings} commitment${meetings === 1 ? "" : "s"} outstanding today.`);
    }
  }

  if (cadence === "midday") {
    const windows = changes.filter((c) => c.kind === "window_opened");
    if (windows.length) {
      lines.push(stripPunctuation(windows[0].summary) + ".");
      const fit = pickForWindow(state, windows[0]);
      if (fit) lines.push(`I recommend using it to ${lowerFirst(stripPunctuation(fit))}.`);
    } else if (changes.length) {
      lines.push(stripPunctuation(changes[0].summary) + ".");
    } else {
      lines.push("Nothing has moved since this morning.");
    }
  }

  if (cadence === "evening") {
    const direction =
      state.trajectory === "accelerating" || state.trajectory === "steady"
        ? "Today's trajectory improved."
        : `Today's trajectory is ${state.trajectory}.`;
    lines.push(direction);

    const eased = changes.find((c) => c.kind === "risk_eased");
    const escalated = changes.find((c) => c.kind === "risk_escalated");
    if (eased) lines.push("Risk decreased.");
    if (escalated) lines.push(`Risk rose to ${state.riskLevel}.`);

    const unresolved = state.signals.waiting.filter((w) => w.overdue);
    if (unresolved.length) {
      lines.push(
        `${unresolved.length} commercial dependenc${unresolved.length === 1 ? "y remains" : "ies remain"} unresolved.`,
      );
    }

    if (delta.decisionChanged) {
      lines.push("Tomorrow's highest-leverage action has changed.");
    }
  }

  if (state.recommendedAction && cadence !== "midday") {
    lines.push(
      `${cadence === "evening" ? "Tomorrow" : "Today"}'s highest-leverage action is ${lowerFirst(stripPunctuation(state.recommendedAction.title))}.`,
    );
  }

  const speech = lines.join(" ");
  return {
    id: crypto.randomUUID(),
    at: state.computedAt,
    channel: "digest",
    cadence,
    title: `${cadence[0].toUpperCase()}${cadence.slice(1)} brief`,
    body: lines.slice(1).join(" "),
    salience: delta.peakSalience,
    changeKinds: [...new Set(changes.map((c) => c.kind))],
    speech,
  };
}

function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
