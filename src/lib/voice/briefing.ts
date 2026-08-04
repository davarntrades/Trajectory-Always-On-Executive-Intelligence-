/**
 * Spoken briefing.
 *
 * Voice reads the same TrajectoryState the dashboard renders — there is one
 * state object, so the two can never disagree. This module turns that state
 * into speech-shaped prose: short sentences, no bullet syntax, no markdown, and
 * the proactive items surfaced without being asked for.
 */

import { config } from "@/lib/config";
import { getStore } from "@/lib/store";
import type { CalendarEntry, TrajectoryState } from "@/lib/types";

function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: config.timezone,
    }).format(now),
  );
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

const spokenTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: config.timezone,
  }).format(new Date(iso));

function describeMeetings(entries: CalendarEntry[]): string | null {
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const today = entries
    .filter((e) => {
      const t = new Date(e.startAt).getTime();
      return t >= now && t <= endOfDay.getTime();
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  if (!today.length) return "Your calendar is clear today.";
  if (today.length === 1) {
    return `You have one meeting today: ${today[0].title} at ${spokenTime(today[0].startAt)}.`;
  }
  return `You have ${today.length} meetings today. First is ${today[0].title} at ${spokenTime(today[0].startAt)}.`;
}

export interface Briefing {
  /** Plain prose for text-to-speech. No markdown. */
  speech: string;
  /** The same content as discrete lines, for captions and transcripts. */
  lines: string[];
  state: TrajectoryState;
}

/**
 * Build the proactive briefing.
 *
 * Order is deliberate: what today holds, what has gone quiet, what moved, then
 * the recommendation with its reason. The reason is never omitted — a
 * recommendation without a why is an instruction, and Trajectory does not give
 * instructions.
 */
export async function buildBriefing(
  state: TrajectoryState,
  ownerName = config.ownerName,
): Promise<Briefing> {
  const store = await getStore();
  const [calendar, entities, events] = await Promise.all([
    store.calendar(),
    store.entities(),
    store.events(3),
  ]);

  const lines: string[] = [];

  lines.push(`${greeting()} ${ownerName}.`);

  const meetings = describeMeetings(calendar);
  if (meetings) lines.push(meetings);

  // Things that have gone quiet — surfaced without being asked.
  for (const w of state.signals.waiting.filter((x) => x.overdue).slice(0, 2)) {
    lines.push(`${w.waitingOn} still hasn't replied — that's ${w.daysWaiting} days now.`);
  }

  // Recent wins, so the brief is not purely a list of problems. The event title
  // is already a complete statement — don't bolt a verb onto the end of it.
  const wins = events.filter(
    (e) => e.type === "github.pr_merged" || e.type === "task.completed",
  );
  if (wins.length) {
    lines.push(`${stripTerminalPunctuation(wins[0].title)}.`);
  }

  if (state.signals.staleOpportunities.length) {
    const opp = state.signals.staleOpportunities[0];
    const company = entities.find((e) => e.id === opp.companyId);
    lines.push(
      `${company?.name ?? opp.name} has gone quiet past its expected reply window.`,
    );
  }

  if (state.recommendedAction) {
    lines.push(
      `I recommend: ${stripTerminalPunctuation(state.recommendedAction.title)}.`,
    );
    lines.push(`Because ${lowerFirst(state.recommendedAction.why)}`);
  } else {
    lines.push("Nothing is blocking. Push the highest-value project forward.");
  }

  if (state.riskLevel === "high" || state.riskLevel === "critical") {
    lines.push(`Heads up — overall risk is ${state.riskLevel}.`);
  }

  return { speech: lines.join(" "), lines, state };
}

const stripTerminalPunctuation = (s: string) => s.replace(/[.!?]+$/, "");
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
