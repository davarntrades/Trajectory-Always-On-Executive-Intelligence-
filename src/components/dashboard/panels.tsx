/**
 * Read-only dashboard panels.
 *
 * These render state; they never compute it. Every number shown here traces to
 * the state engine or the store.
 */

import { Badge, Empty, Meter, Panel } from "@/components/ui/panel";
import type {
  CalendarEntry,
  Entity,
  Goal,
  Opportunity,
  Project,
  ScoredCandidate,
  Task,
  TrajectoryEvent,
  TrajectoryState,
  WaitingItem,
} from "@/lib/types";
import { money, relativeTime, timeOfDay } from "@/lib/utils";

const MOMENTUM_TONE = {
  hot: "positive",
  steady: "accent",
  cooling: "caution",
  stalled: "negative",
} as const;

export function PrioritiesPanel({
  candidates,
}: {
  candidates: ScoredCandidate[];
}) {
  const top = candidates.slice(0, 5);
  return (
    <Panel title="Top priorities" subtitle="ranked by computed leverage">
      {top.length === 0 ? (
        <Empty>Nothing actionable right now.</Empty>
      ) : (
        <ol className="space-y-2.5">
          {top.map((c, i) => (
            <li key={c.id} className="flex gap-3">
              <span className="mt-0.5 font-mono text-xs text-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm text-foreground">{c.title}</p>
                  <span className="shrink-0 font-mono text-xs text-accent">
                    {c.leverage.toFixed(2)}
                  </span>
                </div>
                {/* The factors are the audit trail for the ranking. */}
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                  {c.factors[0]}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function ProjectsPanel({ state }: { state: TrajectoryState }) {
  const momentum = state.signals.projectMomentum;
  return (
    <Panel title="Current projects" subtitle="14-day decayed momentum">
      {momentum.length === 0 ? (
        <Empty>No active projects.</Empty>
      ) : (
        <ul className="space-y-3">
          {momentum.map((m) => (
            <li key={m.projectId}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm text-foreground">{m.projectName}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted">
                    {m.score.toFixed(1)}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      m.delta >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {m.delta >= 0 ? "+" : ""}
                    {m.delta.toFixed(1)}
                  </span>
                  <Badge tone={MOMENTUM_TONE[m.status]}>{m.status}</Badge>
                </div>
              </div>
              <div className="mt-1.5">
                <Meter
                  value={Math.min(1, m.score / 8)}
                  tone={m.status === "stalled" ? "negative" : m.status === "cooling" ? "caution" : "positive"}
                />
              </div>
              <p className="mt-1 text-[11px] text-faint">
                {m.eventsInWindow} events
                {m.lastEventAt ? ` · last ${relativeTime(m.lastEventAt)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function GoalsPanel({ goals }: { goals: Goal[] }) {
  const active = goals.filter((g) => g.status === "active");
  return (
    <Panel title="Goals" subtitle="what the work is for">
      {active.length === 0 ? (
        <Empty>No active goals.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {active.map((g) => (
            <li key={g.id}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm text-foreground">{g.title}</p>
                <Badge tone="neutral">{g.horizon}</Badge>
              </div>
              {g.target ? (
                <p className="mt-0.5 text-[11px] text-faint">Target: {g.target}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function feedFor(events: TrajectoryEvent[], sources: string[], limit = 5) {
  return events.filter((e) => sources.includes(e.source)).slice(0, limit);
}

export function MailPanel({ events }: { events: TrajectoryEvent[] }) {
  const mail = feedFor(events, ["gmail"]);
  return (
    <Panel title="Latest email" subtitle="gmail">
      {mail.length === 0 ? (
        <Empty>Nothing recent.</Empty>
      ) : (
        <ul className="space-y-2">
          {mail.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{e.title}</p>
                {e.body ? (
                  <p className="truncate text-[11px] text-faint">{e.body}</p>
                ) : null}
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

export function GithubPanel({ events }: { events: TrajectoryEvent[] }) {
  const gh = feedFor(events, ["github"]);
  return (
    <Panel title="Recent GitHub activity" subtitle="primary momentum signal">
      {gh.length === 0 ? (
        <Empty>No recent repository activity.</Empty>
      ) : (
        <ul className="space-y-2">
          {gh.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-sm text-foreground">{e.title}</p>
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

export function NotionPanel({ events }: { events: TrajectoryEvent[] }) {
  const notion = feedFor(events, ["notion"]);
  return (
    <Panel title="Recent Notion updates" subtitle="notion">
      {notion.length === 0 ? (
        <Empty>No recent document changes.</Empty>
      ) : (
        <ul className="space-y-2">
          {notion.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{e.title}</p>
                {e.body ? (
                  <p className="truncate text-[11px] text-faint">{e.body}</p>
                ) : null}
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

export function CalendarPanel({
  entries,
  now,
}: {
  entries: CalendarEntry[];
  /** Passed in rather than read during render, so every panel agrees on "now". */
  now: number;
}) {
  const upcoming = entries
    .filter((e) => new Date(e.startAt).getTime() >= now - 36e5)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 5);

  return (
    <Panel title="Calendar" subtitle="next up">
      {upcoming.length === 0 ? (
        <Empty>Clear.</Empty>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="shrink-0 font-mono text-xs text-accent">
                {timeOfDay(e.startAt)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{e.title}</p>
                <p className="truncate text-[11px] text-faint">
                  {new Date(e.startAt).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  {e.location ? ` · ${e.location}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function TasksPanel({ tasks, now }: { tasks: Task[]; now: number }) {
  const open = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return b.impact - a.impact;
    })
    .slice(0, 7);

  const tone = (t: Task) => {
    if (t.status === "blocked") return "negative" as const;
    if (t.status === "waiting") return "caution" as const;
    if (t.status === "in_progress") return "accent" as const;
    return "neutral" as const;
  };

  return (
    <Panel title="Tasks" subtitle={`${tasks.filter((t) => t.status !== "done").length} open`}>
      {open.length === 0 ? (
        <Empty>Clear.</Empty>
      ) : (
        <ul className="space-y-2">
          {open.map((t) => {
            const overdue = t.dueAt && new Date(t.dueAt).getTime() < now;
            return (
              <li key={t.id} className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-foreground">{t.title}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {t.dueAt ? (
                    <span
                      className={`font-mono text-[11px] ${overdue ? "text-negative" : "text-faint"}`}
                    >
                      {relativeTime(t.dueAt)}
                    </span>
                  ) : null}
                  <Badge tone={tone(t)}>{t.status.replace("_", " ")}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function OpportunitiesPanel({
  opportunities,
  entities,
  now,
}: {
  opportunities: Opportunity[];
  entities: Entity[];
  now: number;
}) {
  const live = opportunities
    .filter((o) => o.stage !== "closed_won" && o.stage !== "closed_lost")
    .sort((a, b) => b.value * b.probability - a.value * a.probability);

  const total = live.reduce((s, o) => s + o.value * o.probability, 0);

  return (
    <Panel
      title="Commercial opportunities"
      subtitle={`${money(total)} weighted pipeline`}
    >
      {live.length === 0 ? (
        <Empty>No live opportunities.</Empty>
      ) : (
        <ul className="space-y-3">
          {live.map((o) => {
            const company = entities.find((e) => e.id === o.companyId);
            const quiet = o.lastContactAt
              ? (now - new Date(o.lastContactAt).getTime()) / 864e5
              : Infinity;
            const stale = quiet > o.expectedReplyDays;
            return (
              <li key={o.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm text-foreground">
                    {company?.name ?? o.name}
                  </p>
                  <span className="shrink-0 font-mono text-xs text-foreground">
                    {money(o.value, o.currency)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="neutral">{o.stage}</Badge>
                    <span className="font-mono text-[11px] text-faint">
                      {Math.round(o.probability * 100)}%
                    </span>
                  </div>
                  <span
                    className={`text-[11px] ${stale ? "text-caution" : "text-faint"}`}
                  >
                    {o.lastContactAt
                      ? `contact ${relativeTime(o.lastContactAt)}${stale ? " · quiet" : ""}`
                      : "no contact"}
                  </span>
                </div>
                {o.nextStep ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-faint">
                    Next: {o.nextStep}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function WaitingPanel({
  waiting,
  blocked,
}: {
  waiting: WaitingItem[];
  blocked: Task[];
}) {
  return (
    <Panel
      title="Waiting & blocked"
      subtitle={`${waiting.length} waiting · ${blocked.length} blocked`}
    >
      {waiting.length === 0 && blocked.length === 0 ? (
        <Empty>Nothing outstanding.</Empty>
      ) : (
        <div className="space-y-3">
          {waiting.length > 0 ? (
            <ul className="space-y-1.5">
              {waiting.map((w) => (
                <li key={w.id} className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm text-foreground">
                    {w.title}
                  </p>
                  <span
                    className={`shrink-0 font-mono text-[11px] ${
                      w.overdue ? "text-caution" : "text-faint"
                    }`}
                  >
                    {w.waitingOn} · {w.daysWaiting}d
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {blocked.length > 0 ? (
            <div className="border-t border-border/60 pt-2.5">
              <ul className="space-y-1.5">
                {blocked.slice(0, 4).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start gap-2 text-sm text-muted"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-negative" />
                    <span className="min-w-0 truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function ConnectorsPanel({
  connectors,
}: {
  connectors: { id: string; name: string; configured: boolean; capabilities: { id: string; maxTier: string }[] }[];
}) {
  return (
    <Panel
      title="Connectors"
      subtitle={`${connectors.filter((c) => c.configured).length}/${connectors.length} connected`}
    >
      <ul className="space-y-1.5">
        {connectors.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  c.configured ? "bg-positive" : "bg-border-strong"
                }`}
              />
              <span className="truncate text-sm text-foreground">{c.name}</span>
            </div>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">
              {c.configured ? "live" : "not connected"}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ProjectsIndexPanel({ projects }: { projects: Project[] }) {
  return (
    <Panel title="Project index" subtitle={`${projects.length} tracked`}>
      <ul className="space-y-1.5">
        {projects.map((p) => (
          <li key={p.id} className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-sm text-foreground">{p.name}</p>
            <span className="shrink-0 font-mono text-[11px] text-faint">
              value {p.valueScore.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
