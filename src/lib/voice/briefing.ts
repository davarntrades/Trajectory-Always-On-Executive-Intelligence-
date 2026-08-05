/** Spoken briefing assembled from the same state rendered by the executive view. */
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { config } from "@/lib/config";
import { getStore } from "@/lib/store";
import type { CalendarEntry, TrajectoryState } from "@/lib/types";

function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: config.timezone }).format(now));
  if (hour < 12) return language.briefing.morning;
  if (hour < 18) return language.briefing.afternoon;
  return language.briefing.evening;
}

const spokenTime = (iso: string) => new Intl.DateTimeFormat("en-GB", {
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: config.timezone,
}).format(new Date(iso));

function describeMeetings(entries: CalendarEntry[]): string | null {
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const today = entries.filter((entry) => {
    const time = new Date(entry.startAt).getTime();
    return time >= now && time <= endOfDay.getTime();
  }).sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (!today.length) return language.briefing.calendarClear;
  if (today.length === 1) return language.briefing.oneMeeting(today[0].title, spokenTime(today[0].startAt));
  return language.briefing.meetings(today.length, today[0].title, spokenTime(today[0].startAt));
}

export interface Briefing { speech: string; lines: string[]; state: TrajectoryState }

export async function buildBriefing(state: TrajectoryState, ownerName = config.ownerName): Promise<Briefing> {
  const store = await getStore();
  const [calendar, entities, events] = await Promise.all([store.calendar(), store.entities(), store.events(3)]);
  const lines: string[] = [`${greeting()} ${ownerName}.`];
  const meetings = describeMeetings(calendar);
  if (meetings) lines.push(meetings);

  for (const item of state.signals.waiting.filter((entry) => entry.overdue).slice(0, 2)) {
    lines.push(language.briefing.waiting(item.waitingOn, item.daysWaiting));
  }

  const wins = events.filter((event) => event.type === "github.pr_merged" || event.type === "task.completed");
  if (wins.length) lines.push(`${stripTerminalPunctuation(wins[0].title)}.`);

  if (state.signals.staleOpportunities.length) {
    const opportunity = state.signals.staleOpportunities[0];
    const company = entities.find((entity) => entity.id === opportunity.companyId);
    lines.push(language.briefing.staleOpportunity(company?.name ?? opportunity.name));
  }

  if (state.recommendedAction) {
    lines.push(language.briefing.action(stripTerminalPunctuation(state.recommendedAction.title)));
    lines.push(language.briefing.logic(lowerFirst(state.recommendedAction.why)));
  } else {
    lines.push(language.briefing.noAction);
  }

  if (state.riskLevel === "high" || state.riskLevel === "critical") lines.push(language.briefing.risk(state.riskLevel));
  return { speech: lines.join(" "), lines, state };
}

const stripTerminalPunctuation = (value: string) => value.replace(/[.!?]+$/, "");
const lowerFirst = (value: string) => value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
