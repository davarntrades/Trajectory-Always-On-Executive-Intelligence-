import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { config } from "@/lib/config";
import type { TrajectoryState } from "@/lib/types";
import type { Change, StateDelta } from "./delta";

export type Cadence = "morning" | "midday" | "evening";
export interface Notification {
  id: string;
  at: string;
  channel: "interrupt" | "digest";
  cadence?: Cadence;
  title: string;
  body: string;
  salience: number;
  changeKinds: string[];
  speech: string;
}

function localHour(iso: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: config.timezone }).format(new Date(iso)));
}
export function cadenceFor(iso: string): Cadence {
  const hour = localHour(iso);
  if (hour < 11) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}
const stripPunctuation = (value: string) => value.replace(/[.!?]+$/, "");
const lowerFirst = (value: string) => value ? value.charAt(0).toLowerCase() + value.slice(1) : value;

export function buildInterrupt(state: TrajectoryState, delta: StateDelta): Notification | null {
  const top = delta.changes[0];
  if (!top) return null;
  const lines = [`${stripPunctuation(top.summary)}.`, top.why];
  if (top.kind === "window_opened") {
    const fit = pickForWindow(state, top);
    if (fit) lines.push(language.briefing.action(stripPunctuation(fit)));
  } else if (delta.decisionChanged && state.recommendedAction) {
    lines.push(language.briefing.action(stripPunctuation(state.recommendedAction.title)));
  }
  return {
    id: crypto.randomUUID(), at: state.computedAt, channel: "interrupt", title: top.summary,
    body: lines.slice(1).join(" "), salience: top.salience, changeKinds: [top.kind], speech: lines.join(" "),
  };
}

function pickForWindow(state: TrajectoryState, change: Change): string | null {
  const minutes = Number(/(\d+)\s*minutes/.exec(change.summary)?.[1] ?? 60);
  const hours = minutes / 60;
  return state.signals.candidates.filter((candidate) => candidate.effortHours <= hours * 1.1)
    .map((candidate) => ({ candidate, fit: candidate.leverage * Math.sqrt(Math.min(1, candidate.effortHours / hours)) }))
    .sort((a, b) => b.fit - a.fit)[0]?.candidate.title ?? null;
}

export function buildCadenceBrief(state: TrajectoryState, delta: StateDelta, cadence: Cadence = cadenceFor(state.computedAt)): Notification {
  const lines: string[] = [];
  const changes = delta.changes;
  const greetings: Record<Cadence, string> = {
    morning: language.dailySummary.morningGreeting(config.ownerName),
    midday: language.dailySummary.middayGreeting,
    evening: language.dailySummary.eveningGreeting,
  };
  lines.push(greetings[cadence]);

  if (cadence === "morning") {
    const improving = state.signals.projectMomentum.filter((item) => item.delta > 0.5).sort((a, b) => b.delta - a.delta).slice(0, 2);
    const cooling = state.signals.projectMomentum.filter((item) => item.status === "cooling" || item.status === "stalled").slice(0, 2);
    if (improving.length) lines.push(`Directional momentum strengthened across ${listNames(improving.map((item) => item.projectName))}.`);
    if (cooling.length) lines.push(`Movement softened across ${listNames(cooling.map((item) => item.projectName))}.`);
    lines.push(state.signals.commercialDelta < -0.05 ? "Commercial momentum softened." : state.signals.commercialDelta > 0.05 ? "Commercial momentum strengthened." : "Commercial momentum held steady.");
    const commitments = state.signals.outstandingCommitments.length;
    if (commitments) lines.push(`${commitments} commitment${commitments === 1 ? " remains" : "s remain"} active today.`);
  }

  if (cadence === "midday") {
    const window = changes.find((change) => change.kind === "window_opened");
    if (window) {
      lines.push(`${stripPunctuation(window.summary)}.`);
      const fit = pickForWindow(state, window);
      if (fit) lines.push(language.briefing.action(lowerFirst(stripPunctuation(fit))));
    } else if (changes.length) lines.push(`${stripPunctuation(changes[0].summary)}.`);
    else lines.push(language.emptyStates.noChanges);
  }

  if (cadence === "evening") {
    lines.push(state.trajectory === "accelerating" || state.trajectory === "steady" ? "Today’s trajectory strengthened." : directionFor(state.trajectory));
    if (changes.some((change) => change.kind === "risk_eased")) lines.push("Risk decreased.");
    if (changes.some((change) => change.kind === "risk_escalated")) lines.push(language.briefing.risk(state.riskLevel));
    const unresolved = state.signals.waiting.filter((item) => item.overdue).length;
    if (unresolved) lines.push(`${unresolved} commercial dependenc${unresolved === 1 ? "y remains" : "ies remain"} unresolved.`);
  }

  if (state.recommendedAction && cadence !== "midday") lines.push(language.briefing.action(lowerFirst(stripPunctuation(state.recommendedAction.title))));
  const titles: Record<Cadence, string> = {
    morning: language.dailySummary.morningTitle,
    midday: language.dailySummary.middayTitle,
    evening: language.dailySummary.eveningTitle,
  };
  return {
    id: crypto.randomUUID(), at: state.computedAt, channel: "digest", cadence, title: titles[cadence],
    body: lines.slice(1).join(" "), salience: delta.peakSalience,
    changeKinds: [...new Set(changes.map((change) => change.kind))], speech: lines.join(" "),
  };
}

function directionFor(direction: TrajectoryState["trajectory"]) {
  return direction === "slipping" ? language.trajectory.slipping : direction === "stalled" ? language.trajectory.stalled : language.trajectory.steady;
}
function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
