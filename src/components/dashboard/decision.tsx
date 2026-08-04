/**
 * The decision surface.
 *
 * This is the reason the product exists: today's objective, the bottleneck, the
 * single recommended action, and — always — the reasoning behind it. The `why`
 * is not collapsible and not optional. A recommendation without its reasoning
 * is an instruction, and Trajectory does not give instructions.
 */

import { Badge, Meter, Panel } from "@/components/ui/panel";
import type { TrajectoryState } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIRECTION_TONE = {
  accelerating: "positive",
  steady: "accent",
  slipping: "caution",
  stalled: "negative",
} as const;

const RISK_TONE = {
  low: "positive",
  elevated: "caution",
  high: "negative",
  critical: "critical",
} as const;

export function DecisionPanel({ state }: { state: TrajectoryState }) {
  const { recommendedAction: action, bottleneck } = state;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      {/* Objective + recommendation */}
      <section className="flex flex-col rounded-xl border border-accent/40 bg-accent/[0.05] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Today&rsquo;s objective
            </p>
            <h1 className="mt-1.5 text-xl font-semibold leading-snug text-foreground">
              {state.todaysObjective}
            </h1>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge tone={DIRECTION_TONE[state.trajectory]}>{state.trajectory}</Badge>
            <Badge tone={RISK_TONE[state.riskLevel]}>{state.riskLevel} risk</Badge>
          </div>
        </div>

        {state.reasoning ? (
          <p className="mt-4 border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-muted">
            {state.reasoning}
          </p>
        ) : null}

        {action ? (
          <div className="mt-5 rounded-lg border border-border bg-surface/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Recommended next action
              </p>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">tier: {action.tier}</Badge>
                <Badge tone="accent">leverage {action.leverage.toFixed(2)}</Badge>
              </div>
            </div>

            <p className="mt-2 text-base font-medium leading-snug text-foreground">
              {action.title}
            </p>

            <div className="mt-3 rounded-md bg-background/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                Why
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{action.why}</p>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-faint">
            No candidate actions. Nothing is blocked and nothing is overdue.
          </p>
        )}
      </section>

      {/* Bottleneck */}
      <Panel
        title="Current bottleneck"
        subtitle={
          bottleneck
            ? `${bottleneck.effortHours}h of work holding ${bottleneck.dependencyCount} item(s)`
            : "nothing is blocking"
        }
        tone={bottleneck ? "warning" : "default"}
      >
        {bottleneck ? (
          <div className="space-y-3">
            <p className="text-sm font-medium leading-snug text-foreground">
              {bottleneck.title}
            </p>

            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat label="blocking" value={bottleneck.blockingScore.toFixed(2)} />
              <Stat label="downstream" value={bottleneck.downstreamValue.toFixed(2)} />
              <Stat label="effort" value={`${bottleneck.effortHours}h`} />
            </dl>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                Blocked behind it
              </p>
              <ul className="mt-1.5 space-y-1">
                {bottleneck.blockedItems.slice(0, 5).map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-xs leading-relaxed text-muted"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-caution" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-faint">
            No task is holding downstream work. Momentum is the constraint, not
            dependency.
          </p>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/40 py-2">
      <dd className="font-mono text-sm text-foreground">{value}</dd>
      <dt className="mt-0.5 text-[10px] uppercase tracking-wider text-faint">{label}</dt>
    </div>
  );
}

export function SignalStrip({ state }: { state: TrajectoryState }) {
  const s = state.signals;
  const items: { label: string; value: string; tone?: "warn" | "bad" }[] = [
    { label: "Commercial momentum", value: s.commercialMomentum.toFixed(2) },
    {
      label: "Overdue",
      value: String(s.overdueCount),
      tone: s.overdueCount > 0 ? "bad" : undefined,
    },
    {
      label: "Blocked",
      value: String(s.blocked.length),
      tone: s.blocked.length > 2 ? "warn" : undefined,
    },
    {
      label: "Waiting",
      value: String(s.waiting.length),
      tone: s.waiting.some((w) => w.overdue) ? "warn" : undefined,
    },
    { label: "Events 24h", value: String(s.eventsLast24h) },
    { label: "Candidates", value: String(s.candidates.length) },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
      {items.map((i) => (
        <div
          key={i.label}
          className="rounded-lg border border-border bg-surface/60 px-3 py-2"
        >
          <p
            className={cn(
              "font-mono text-lg leading-none",
              i.tone === "bad" && "text-negative",
              i.tone === "warn" && "text-caution",
              !i.tone && "text-foreground",
            )}
          >
            {i.value}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-faint">
            {i.label}
          </p>
        </div>
      ))}
      <div className="col-span-3 md:col-span-6">
        <Meter
          value={state.commercialMomentum}
          tone={state.commercialMomentum > 0.5 ? "positive" : "caution"}
        />
      </div>
    </div>
  );
}
