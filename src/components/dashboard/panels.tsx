import { Badge, Empty, Meter, Panel } from "@/components/ui/panel";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import type { CalendarEntry, Entity, Goal, Opportunity, Project, ScoredCandidate, Task, TrajectoryEvent, TrajectoryState, WaitingItem } from "@/lib/types";
import { money, relativeTime, timeOfDay } from "@/lib/utils";

const MOMENTUM_TONE = { hot: "positive", steady: "accent", cooling: "caution", stalled: "negative" } as const;
const feedFor = (events: TrajectoryEvent[], sources: string[], limit = 5) => events.filter((event) => sources.includes(event.source)).slice(0, limit);

export function PrioritiesPanel({ candidates }: { candidates: ScoredCandidate[] }) {
  const top = candidates.slice(0, 5);
  return <Panel title={language.panels.topPriorities} subtitle={language.panels.rankedByComputedLeverage}>{top.length === 0 ? <Empty>{language.emptyStates.noActions}</Empty> : <ol className="space-y-2.5">{top.map((candidate, index) => <li key={candidate.id} className="flex gap-3"><span className="mt-0.5 font-mono text-xs text-faint">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className="truncate text-sm text-foreground">{candidate.title}</p><span className="shrink-0 font-mono text-xs text-accent">{candidate.leverage.toFixed(2)}</span></div><p className="mt-0.5 text-[11px] leading-relaxed text-faint">{candidate.factors[0]}</p></div></li>)}</ol>}</Panel>;
}

export function ProjectsPanel({ state }: { state: TrajectoryState }) {
  const momentum = state.signals.projectMomentum;
  return <Panel title={language.panels.currentProjects} subtitle={language.panels.momentumWindow}>{momentum.length === 0 ? <Empty>{language.panels.noActiveProjects}</Empty> : <ul className="space-y-3">{momentum.map((item) => <li key={item.projectId}><div className="flex items-baseline justify-between gap-2"><p className="truncate text-sm text-foreground">{item.projectName}</p><div className="flex shrink-0 items-center gap-2"><span className="font-mono text-xs text-muted">{item.score.toFixed(1)}</span><Badge tone={MOMENTUM_TONE[item.status]}>{item.status}</Badge></div></div><div className="mt-1.5"><Meter value={Math.min(1, item.score / 8)} tone={item.status === "stalled" ? "negative" : item.status === "cooling" ? "caution" : "positive"} /></div><p className="mt-1 text-[11px] text-faint">{item.eventsInWindow}{item.lastEventAt ? ` · ${relativeTime(item.lastEventAt)}` : ""}</p></li>)}</ul>}</Panel>;
}

export function GoalsPanel({ goals }: { goals: Goal[] }) {
  const active = goals.filter((goal) => goal.status === "active");
  return <Panel title={language.panels.goals} subtitle={language.panels.goalsPurpose}>{active.length === 0 ? <Empty>{language.panels.noActiveGoals}</Empty> : <ul className="space-y-2.5">{active.map((goal) => <li key={goal.id}><div className="flex items-baseline justify-between gap-2"><p className="text-sm text-foreground">{goal.title}</p><Badge tone="neutral">{goal.horizon}</Badge></div>{goal.target ? <p className="mt-0.5 text-[11px] text-faint">{language.panels.target} {goal.target}</p> : null}</li>)}</ul>}</Panel>;
}

function EventFeed({ title, subtitle, events, empty }: { title: string; subtitle: string; events: TrajectoryEvent[]; empty: string }) {
  return <Panel title={title} subtitle={subtitle}>{events.length === 0 ? <Empty>{empty}</Empty> : <ul className="space-y-2">{events.map((event) => <li key={event.id} className="flex items-baseline justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm text-foreground">{event.title}</p>{event.body ? <p className="truncate text-[11px] text-faint">{event.body}</p> : null}</div><span className="shrink-0 font-mono text-[11px] text-faint">{relativeTime(event.occurredAt)}</span></li>)}</ul>}</Panel>;
}
export function MailPanel({ events }: { events: TrajectoryEvent[] }) { return <EventFeed title={language.panels.latestEmail} subtitle="Gmail" events={feedFor(events, ["gmail"])} empty={language.panels.nothingRecent} />; }
export function GithubPanel({ events }: { events: TrajectoryEvent[] }) { return <EventFeed title={language.panels.recentGithub} subtitle="GitHub" events={feedFor(events, ["github"])} empty={language.panels.noRepositoryActivity} />; }
export function NotionPanel({ events }: { events: TrajectoryEvent[] }) { return <EventFeed title={language.panels.recentNotion} subtitle="Notion" events={feedFor(events, ["notion"])} empty={language.panels.noDocumentChanges} />; }

export function CalendarPanel({ entries, now }: { entries: CalendarEntry[]; now: number }) {
  const upcoming = entries.filter((entry) => new Date(entry.startAt).getTime() >= now - 36e5).sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 5);
  return <Panel title={language.panels.calendar} subtitle={language.panels.nextUp}>{upcoming.length === 0 ? <Empty>{language.panels.clear}</Empty> : <ul className="space-y-2">{upcoming.map((entry) => <li key={entry.id} className="flex gap-3"><span className="shrink-0 font-mono text-xs text-accent">{timeOfDay(entry.startAt)}</span><div className="min-w-0"><p className="truncate text-sm text-foreground">{entry.title}</p><p className="truncate text-[11px] text-faint">{new Date(entry.startAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}{entry.location ? ` · ${entry.location}` : ""}</p></div></li>)}</ul>}</Panel>;
}

export function TasksPanel({ tasks, now }: { tasks: Task[]; now: number }) {
  const open = tasks.filter((task) => task.status !== "done").sort((a, b) => a.dueAt && b.dueAt ? a.dueAt.localeCompare(b.dueAt) : a.dueAt ? -1 : b.dueAt ? 1 : b.impact - a.impact).slice(0, 7);
  return <Panel title={language.panels.tasks} subtitle={`${open.length}`}>{open.length === 0 ? <Empty>{language.panels.clear}</Empty> : <ul className="space-y-2">{open.map((task) => { const overdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < now); return <li key={task.id} className="flex items-baseline justify-between gap-2"><p className="min-w-0 truncate text-sm text-foreground">{task.title}</p><div className="flex shrink-0 items-center gap-2">{task.dueAt ? <span className={`font-mono text-[11px] ${overdue ? "text-negative" : "text-faint"}`}>{relativeTime(task.dueAt)}</span> : null}<Badge tone={task.status === "blocked" ? "negative" : task.status === "waiting" ? "caution" : task.status === "in_progress" ? "accent" : "neutral"}>{task.status.replace("_", " ")}</Badge></div></li>; })}</ul>}</Panel>;
}

export function OpportunitiesPanel({ opportunities, entities, now }: { opportunities: Opportunity[]; entities: Entity[]; now: number }) {
  const live = opportunities.filter((item) => item.stage !== "closed_won" && item.stage !== "closed_lost").sort((a, b) => b.value * b.probability - a.value * a.probability);
  const total = live.reduce((sum, item) => sum + item.value * item.probability, 0);
  return <Panel title={language.panels.commercialOpportunities} subtitle={money(total)}>{live.length === 0 ? <Empty>{language.panels.noLiveOpportunities}</Empty> : <ul className="space-y-3">{live.map((item) => { const company = entities.find((entity) => entity.id === item.companyId); const quiet = item.lastContactAt ? (now - new Date(item.lastContactAt).getTime()) / 864e5 : Infinity; const stale = quiet > item.expectedReplyDays; return <li key={item.id}><div className="flex items-baseline justify-between gap-2"><p className="min-w-0 truncate text-sm text-foreground">{company?.name ?? item.name}</p><span className="shrink-0 font-mono text-xs text-foreground">{money(item.value, item.currency)}</span></div><div className="mt-1 flex items-center justify-between gap-2"><Badge tone="neutral">{item.stage}</Badge><span className={`text-[11px] ${stale ? "text-caution" : "text-faint"}`}>{item.lastContactAt ? relativeTime(item.lastContactAt) : language.panels.noContact}</span></div>{item.nextStep ? <p className="mt-1 text-[11px] leading-relaxed text-faint">{language.panels.next} {item.nextStep}</p> : null}</li>; })}</ul>}</Panel>;
}

export function WaitingPanel({ waiting, blocked }: { waiting: WaitingItem[]; blocked: Task[] }) {
  return <Panel title={language.panels.waitingBlocked} subtitle={`${waiting.length} · ${blocked.length}`}>{waiting.length === 0 && blocked.length === 0 ? <Empty>{language.panels.nothingOutstanding}</Empty> : <div className="space-y-3">{waiting.length ? <ul className="space-y-1.5">{waiting.map((item) => <li key={item.id} className="flex items-baseline justify-between gap-2"><p className="min-w-0 truncate text-sm text-foreground">{item.title}</p><span className={`shrink-0 font-mono text-[11px] ${item.overdue ? "text-caution" : "text-faint"}`}>{item.waitingOn} · {item.daysWaiting}d</span></li>)}</ul> : null}{blocked.length ? <ul className="space-y-1.5 border-t border-border/60 pt-2.5">{blocked.slice(0, 4).map((task) => <li key={task.id} className="text-sm text-muted">{task.title}</li>)}</ul> : null}</div>}</Panel>;
}

export function ConnectorsPanel({ connectors }: { connectors: { id: string; name: string; configured: boolean; capabilities: { id: string; maxTier: string }[] }[] }) {
  return <Panel title={language.dashboard.services} subtitle={language.dashboard.connectedWorld}><ul className="space-y-2">{connectors.map((connector) => <li key={connector.id} className="flex items-baseline justify-between gap-2"><span className="text-sm text-foreground">{connector.name}</span><Badge tone={connector.configured ? "positive" : "neutral"}>{connector.configured ? language.status.connected : language.status.configurationRequired}</Badge></li>)}</ul></Panel>;
}

export function ProjectsIndexPanel({ projects }: { projects: Project[] }) {
  return <Panel title={language.panels.currentProjects} subtitle={`${projects.length}`}><ul className="space-y-1.5">{projects.map((project) => <li key={project.id} className="flex items-baseline justify-between gap-2"><span className="truncate text-sm text-foreground">{project.name}</span><Badge tone="neutral">{project.status}</Badge></li>)}</ul></Panel>;
}
