/**
 * Panels driven by the executive loop.
 *
 * These render what *changed* and why, rather than what is. That distinction is
 * what makes the dashboard feel like something living alongside the user rather
 * than a report they have to interpret.
 */

import { Badge, Empty, Panel } from "@/components/ui/panel";
import type { Change, StateDelta } from "@/lib/loop/delta";
import { INTERRUPT_THRESHOLD } from "@/lib/loop/delta";
import type { ScoredCandidate, Task, TrajectoryEvent, TrajectoryState } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

const KIND_TONE: Record<string, "positive" | "caution" | "negative" | "accent" | "neutral"> = {
  recommendation_changed: "accent",
  bottleneck_cleared: "positive",
  bottleneck_changed: "caution",
  risk_escalated: "negative",
  risk_eased: "positive",
  momentum_shift: "caution",
  opportunity_stalled: "caution",
  reply_received: "positive",
  dependency_cleared: "positive",
  deadline_critical: "negative",
  window_opened: "accent",
  new_opportunity: "accent",
};

const label = (k: string) => k.replace(/_/g, " ");

export function RecentChangesPanel({ delta }: { delta: StateDelta }) {
  const changes: Change[] = delta.changes.slice(0, 6);

  return (
    <Panel
      title="Recent changes"
      subtitle={
        delta.from
          ? `since ${relativeTime(delta.from)}`
          : "first pass — baseline"
      }
    >
      {changes.length === 0 ? (
        <Empty>Nothing has moved.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {changes.map((c, i) => (
            <li key={`${c.kind}-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm leading-snug text-foreground">
                  {c.summary}
                </p>
                <Badge tone={KIND_TONE[c.kind] ?? "neutral"}>{label(c.kind)}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                {c.why}
                {c.salience >= INTERRUPT_THRESHOLD ? " · would interrupt" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function WhyPanel({ state }: { state: TrajectoryState }) {
  const action = state.recommendedAction;
  const candidate = state.signals.candidates.find(
    (c) => c.id === action?.candidateId,
  );

  return (
    <Panel title="Why this recommendation" tone="accent">
      {action ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-muted">{action.why}</p>

          {candidate ? (
            <div className="border-t border-border/60 pt-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                Inputs
              </p>
              <ul className="mt-1.5 space-y-1">
                {candidate.factors.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[11px] text-muted">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/70" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {state.reasoning ? (
            <p className="border-t border-border/60 pt-2.5 text-xs leading-relaxed text-faint">
              {state.reasoning}
            </p>
          ) : null}
        </div>
      ) : (
        <Empty>No action recommended.</Empty>
      )}
    </Panel>
  );
}

export function AvailableActionsPanel({
  candidates,
  chosenId,
}: {
  candidates: ScoredCandidate[];
  chosenId?: string;
}) {
  const top = candidates.slice(0, 5);
  return (
    <Panel title="Top five available actions" subtitle="ranked by leverage">
      {top.length === 0 ? (
        <Empty>Nothing available.</Empty>
      ) : (
        <ol className="space-y-2">
          {top.map((c, i) => {
            const chosen = c.id === chosenId;
            return (
              <li key={c.id} className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={
                        chosen
                          ? "truncate text-sm font-medium text-accent"
                          : "truncate text-sm text-foreground"
                      }
                    >
                      {c.title}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {c.leverage.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-faint">
                    {c.effortHours}h · impact {c.impact.toFixed(2)}
                    {chosen ? " · recommended" : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

export function CommitmentsPanel({
  commitments,
  now,
}: {
  commitments: Task[];
  now: number;
}) {
  const sorted = [...commitments]
    .filter((t) => t.dueAt)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 6);

  return (
    <Panel title="Upcoming commitments" subtitle={`${commitments.length} outstanding`}>
      {sorted.length === 0 ? (
        <Empty>None outstanding.</Empty>
      ) : (
        <ul className="space-y-2">
          {sorted.map((t) => {
            const overdue = new Date(t.dueAt!).getTime() < now;
            const critical =
              !overdue && new Date(t.dueAt!).getTime() - now < 24 * 36e5;
            return (
              <li key={t.id} className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-foreground">{t.title}</p>
                <span
                  className={`shrink-0 font-mono text-[11px] ${
                    overdue ? "text-negative" : critical ? "text-caution" : "text-faint"
                  }`}
                >
                  {relativeTime(t.dueAt!)}
                  {overdue ? " · overdue" : critical ? " · critical" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function RecentWinsPanel({ events }: { events: TrajectoryEvent[] }) {
  const wins = events
    .filter(
      (e) =>
        e.type === "github.pr_merged" ||
        e.type === "task.completed" ||
        e.type === "deal.stage_advanced" ||
        e.type === "github.issue_closed",
    )
    .slice(0, 5);

  return (
    <Panel title="Recent wins" subtitle="last 14 days">
      {wins.length === 0 ? (
        <Empty>Nothing shipped recently.</Empty>
      ) : (
        <ul className="space-y-2">
          {wins.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-positive">✓</span>
                <p className="truncate text-sm text-foreground">{e.title}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-faint">
                {relativeTime(e.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RiskPanel({ state }: { state: TrajectoryState }) {
  const s = state.signals;
  const indicators: { label: string; value: string; bad: boolean }[] = [
    {
      label: "Overdue commitments",
      value: String(s.overdueCount),
      bad: s.overdueCount > 0,
    },
    {
      label: "Pipeline past reply window",
      value: `£${Math.round(
        s.staleOpportunities.reduce((sum, o) => sum + o.value, 0) / 1000,
      )}k`,
      bad: s.staleOpportunities.length > 0,
    },
    {
      label: "Waiting beyond 5 days",
      value: String(s.waiting.filter((w) => w.overdue).length),
      bad: s.waiting.some((w) => w.overdue),
    },
    {
      label: "Blocked items",
      value: String(s.blocked.length),
      bad: s.blocked.length >= 3,
    },
    {
      label: "Stalled projects",
      value: String(s.projectMomentum.filter((m) => m.status === "stalled").length),
      bad: s.projectMomentum.some((m) => m.status === "stalled"),
    },
  ];

  return (
    <Panel
      title="Risk indicators"
      subtitle={`overall ${state.riskLevel}`}
      tone={state.riskLevel === "high" || state.riskLevel === "critical" ? "warning" : "default"}
    >
      <ul className="space-y-1.5">
        {indicators.map((i) => (
          <li key={i.label} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-muted">{i.label}</span>
            <span
              className={`shrink-0 font-mono text-sm ${i.bad ? "text-negative" : "text-positive"}`}
            >
              {i.value}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function NotificationsPanel({
  notifications,
}: {
  notifications: { id: string; at: string; channel: string; title: string; body: string; cadence?: string }[];
}) {
  return (
    <Panel
      title="What Trajectory has said"
      subtitle={`${notifications.length} in the log`}
    >
      {notifications.length === 0 ? (
        <Empty>
          Nothing yet. Trajectory speaks only when the trajectory changes.
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {notifications.slice(0, 5).map((n) => (
            <li key={n.id}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-foreground">{n.title}</p>
                <Badge tone={n.channel === "interrupt" ? "negative" : "neutral"}>
                  {n.cadence ?? n.channel}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                {n.body || "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
