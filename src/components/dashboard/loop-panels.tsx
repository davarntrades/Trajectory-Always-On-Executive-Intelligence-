import { Badge, Empty, Panel } from "@/components/ui/panel";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import type { Change, StateDelta } from "@/lib/loop/delta";
import { INTERRUPT_THRESHOLD } from "@/lib/loop/delta";
import type { ScoredCandidate, Task, TrajectoryEvent, TrajectoryState } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

const KIND_TONE: Record<string, "positive" | "caution" | "negative" | "accent" | "neutral"> = {
  recommendation_changed: "accent", bottleneck_cleared: "positive", bottleneck_changed: "caution",
  risk_escalated: "negative", risk_eased: "positive", momentum_shift: "caution",
  opportunity_stalled: "caution", reply_received: "positive", dependency_cleared: "positive",
  deadline_critical: "negative", window_opened: "accent", new_opportunity: "accent",
};
const label = (value: string) => value.replace(/_/g, " ");

export function RecentChangesPanel({ delta }: { delta: StateDelta }) {
  const changes: Change[] = delta.changes.slice(0, 6);
  return <Panel title={language.notifications.recentChanges} subtitle={delta.from ? `since ${relativeTime(delta.from)}` : language.notifications.firstBaseline}>
    {changes.length === 0 ? <Empty>{language.notifications.noMovement}</Empty> : <ul className="space-y-2.5">{changes.map((change, index) => <li key={`${change.kind}-${index}`}><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-sm leading-snug text-foreground">{change.summary}</p><Badge tone={KIND_TONE[change.kind] ?? "neutral"}>{label(change.kind)}</Badge></div><p className="mt-0.5 text-[11px] leading-relaxed text-faint">{change.why}{change.salience >= INTERRUPT_THRESHOLD ? language.notifications.wouldInterrupt : ""}</p></li>)}</ul>}
  </Panel>;
}

export function WhyPanel({ state }: { state: TrajectoryState }) {
  const action = state.recommendedAction;
  const candidate = state.signals.candidates.find((item) => item.id === action?.candidateId);
  return <Panel title={language.notifications.trajectoryLogic} tone="accent">{action ? <div className="space-y-3"><p className="text-sm leading-relaxed text-muted">{action.why}</p>{candidate ? <div className="border-t border-border/60 pt-2.5"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{language.notifications.inputs}</p><ul className="mt-1.5 space-y-1">{candidate.factors.map((factor) => <li key={factor} className="flex items-start gap-2 text-[11px] text-muted"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/70" />{factor}</li>)}</ul></div> : null}{state.reasoning ? <p className="border-t border-border/60 pt-2.5 text-xs leading-relaxed text-faint">{state.reasoning}</p> : null}</div> : <Empty>{language.notifications.noActions}</Empty>}</Panel>;
}

export function AvailableActionsPanel({ candidates, chosenId }: { candidates: ScoredCandidate[]; chosenId?: string }) {
  const top = candidates.slice(0, 5);
  return <Panel title={language.notifications.availableActions} subtitle={language.notifications.rankedByLeverage}>{top.length === 0 ? <Empty>{language.notifications.noActions}</Empty> : <ol className="space-y-2">{top.map((candidate, index) => { const chosen = candidate.id === chosenId; return <li key={candidate.id} className="flex items-baseline gap-3"><span className="font-mono text-xs text-faint">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className={chosen ? "truncate text-sm font-medium text-accent" : "truncate text-sm text-foreground"}>{candidate.title}</p><span className="shrink-0 font-mono text-xs text-muted">{candidate.leverage.toFixed(2)}</span></div><p className="text-[11px] text-faint">{candidate.effortHours}h · {candidate.impact.toFixed(2)}{chosen ? language.notifications.recommended : ""}</p></div></li>; })}</ol>}</Panel>;
}

export function CommitmentsPanel({ commitments, now }: { commitments: Task[]; now: number }) {
  const sorted = [...commitments].filter((task) => task.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)).slice(0, 6);
  return <Panel title={language.notifications.upcomingCommitments} subtitle={`${commitments.length}`}>{sorted.length === 0 ? <Empty>{language.notifications.noneOutstanding}</Empty> : <ul className="space-y-2">{sorted.map((task) => { const overdue = new Date(task.dueAt!).getTime() < now; const critical = !overdue && new Date(task.dueAt!).getTime() - now < 24 * 36e5; return <li key={task.id} className="flex items-baseline justify-between gap-2"><p className="min-w-0 truncate text-sm text-foreground">{task.title}</p><span className={`shrink-0 font-mono text-[11px] ${overdue ? "text-negative" : critical ? "text-caution" : "text-faint"}`}>{relativeTime(task.dueAt!)}{overdue ? language.notifications.overdueSuffix : critical ? language.notifications.criticalSuffix : ""}</span></li>; })}</ul>}</Panel>;
}

export function RecentWinsPanel({ events }: { events: TrajectoryEvent[] }) {
  const wins = events.filter((event) => ["github.pr_merged", "task.completed", "deal.stage_advanced", "github.issue_closed"].includes(event.type)).slice(0, 5);
  return <Panel title={language.notifications.recentWins} subtitle={language.notifications.last14Days}>{wins.length === 0 ? <Empty>{language.notifications.nothingShipped}</Empty> : <ul className="space-y-2">{wins.map((event) => <li key={event.id} className="flex items-baseline justify-between gap-2"><div className="flex min-w-0 items-baseline gap-2"><span className="shrink-0 text-positive">✓</span><p className="truncate text-sm text-foreground">{event.title}</p></div><span className="shrink-0 font-mono text-[11px] text-faint">{relativeTime(event.occurredAt)}</span></li>)}</ul>}</Panel>;
}

export function RiskPanel({ state }: { state: TrajectoryState }) {
  const signals = state.signals;
  const indicators = [
    { label: language.decision.overdue, value: String(signals.overdueCount), bad: signals.overdueCount > 0 },
    { label: language.decision.waiting, value: String(signals.waiting.filter((item) => item.overdue).length), bad: signals.waiting.some((item) => item.overdue) },
    { label: language.decision.blocked, value: String(signals.blocked.length), bad: signals.blocked.length >= 3 },
    { label: language.status.stalled, value: String(signals.projectMomentum.filter((item) => item.status === "stalled").length), bad: signals.projectMomentum.some((item) => item.status === "stalled") },
  ];
  return <Panel title={language.notifications.riskIndicators} subtitle={state.riskLevel} tone={state.riskLevel === "high" || state.riskLevel === "critical" ? "warning" : "default"}><ul className="space-y-1.5">{indicators.map((item) => <li key={item.label} className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate text-sm text-muted">{item.label}</span><span className={`shrink-0 font-mono text-sm ${item.bad ? "text-negative" : "text-positive"}`}>{item.value}</span></li>)}</ul></Panel>;
}

export function NotificationsPanel({ notifications }: { notifications: { id: string; at: string; channel: string; title: string; body: string; cadence?: string }[] }) {
  return <Panel title={language.notifications.signalLog} subtitle={`${notifications.length}`}>{notifications.length === 0 ? <Empty>{language.notifications.emptyLog}</Empty> : <ul className="space-y-2.5">{notifications.slice(0, 5).map((notification) => <li key={notification.id}><div className="flex items-baseline justify-between gap-2"><p className="min-w-0 truncate text-sm text-foreground">{notification.title}</p><Badge tone={notification.channel === "interrupt" ? "negative" : "neutral"}>{notification.cadence ?? notification.channel}</Badge></div><p className="mt-0.5 text-[11px] leading-relaxed text-faint">{notification.body || "—"}</p></li>)}</ul>}</Panel>;
}
