import { Badge, Meter, Panel } from "@/components/ui/panel";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import type { TrajectoryState } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIRECTION_TONE = { accelerating: "positive", steady: "accent", slipping: "caution", stalled: "negative" } as const;
const RISK_TONE = { low: "positive", elevated: "caution", high: "negative", critical: "critical" } as const;

export function DecisionPanel({ state }: { state: TrajectoryState }) {
  const { recommendedAction: action, bottleneck } = state;
  return <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <section className="flex flex-col rounded-xl border border-accent/40 bg-accent/[0.05] p-5">
      <div className="flex items-start justify-between gap-4"><div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{language.decision.todaysObjective}</p>
        <h1 className="mt-1.5 text-xl font-semibold leading-snug text-foreground">{state.todaysObjective}</h1>
      </div><div className="flex shrink-0 flex-col items-end gap-1.5"><Badge tone={DIRECTION_TONE[state.trajectory]}>{state.trajectory}</Badge><Badge tone={RISK_TONE[state.riskLevel]}>{state.riskLevel}</Badge></div></div>
      {state.reasoning ? <div className="mt-4 border-l-2 border-accent/40 pl-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{language.headings.trajectoryLogic}</p><p className="mt-1 text-sm leading-relaxed text-muted">{state.reasoning}</p></div> : null}
      {action ? <div className="mt-5 rounded-lg border border-border bg-surface/80 p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{language.decision.recommendedAction}</p><div className="flex items-center gap-2"><Badge tone="neutral">{language.decision.tier}: {action.tier}</Badge><Badge tone="accent">{language.decision.leverage} {action.leverage.toFixed(2)}</Badge></div></div>
        <p className="mt-2 text-base font-medium leading-snug text-foreground">{action.title}</p>
        <div className="mt-3 rounded-md bg-background/60 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{language.headings.trajectoryLogic}</p><p className="mt-1 text-sm leading-relaxed text-muted">{action.why}</p></div>
      </div> : <p className="mt-5 text-sm text-faint">{language.decision.noCandidates}</p>}
    </section>
    <Panel title={language.decision.currentBottleneck} subtitle={bottleneck ? `${bottleneck.effortHours}h · ${bottleneck.dependencyCount} ${language.decision.downstream}` : language.trajectory.nothingBlocking} tone={bottleneck ? "warning" : "default"}>
      {bottleneck ? <div className="space-y-3"><p className="text-sm font-medium leading-snug text-foreground">{bottleneck.title}</p><dl className="grid grid-cols-3 gap-2 text-center"><Stat label={language.decision.blocking} value={bottleneck.blockingScore.toFixed(2)} /><Stat label={language.decision.downstream} value={bottleneck.downstreamValue.toFixed(2)} /><Stat label={language.decision.effort} value={`${bottleneck.effortHours}h`} /></dl><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{language.decision.blockedBehind}</p><ul className="mt-1.5 space-y-1">{bottleneck.blockedItems.slice(0, 5).map((item) => <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-muted"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-caution" />{item}</li>)}</ul></div></div> : <p className="text-sm text-faint">{language.decision.nothingBlocking}</p>}
    </Panel>
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border/70 bg-background/40 py-2"><dd className="font-mono text-sm text-foreground">{value}</dd><dt className="mt-0.5 text-[10px] uppercase tracking-wider text-faint">{label}</dt></div>;
}

export function SignalStrip({ state }: { state: TrajectoryState }) {
  const signals = state.signals;
  const items: { label: string; value: string; tone?: "warn" | "bad" }[] = [
    { label: language.decision.commercialMomentum, value: signals.commercialMomentum.toFixed(2) },
    { label: language.decision.overdue, value: String(signals.overdueCount), tone: signals.overdueCount > 0 ? "bad" : undefined },
    { label: language.decision.blocked, value: String(signals.blocked.length), tone: signals.blocked.length > 2 ? "warn" : undefined },
    { label: language.decision.waiting, value: String(signals.waiting.length), tone: signals.waiting.some((item) => item.overdue) ? "warn" : undefined },
    { label: language.decision.events24h, value: String(signals.eventsLast24h) },
    { label: language.decision.candidates, value: String(signals.candidates.length) },
  ];
  return <div className="grid grid-cols-3 gap-2 md:grid-cols-6">{items.map((item) => <div key={item.label} className="rounded-lg border border-border bg-surface/60 px-3 py-2"><p className={cn("font-mono text-lg leading-none", item.tone === "bad" && "text-negative", item.tone === "warn" && "text-caution", !item.tone && "text-foreground")}>{item.value}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-faint">{item.label}</p></div>)}<div className="col-span-3 md:col-span-6"><Meter value={state.commercialMomentum} tone={state.commercialMomentum > 0.5 ? "positive" : "caution"} /></div></div>;
}
