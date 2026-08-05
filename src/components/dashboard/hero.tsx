import { Badge, Meter } from "@/components/ui/panel";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import type { TrajectoryState } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIRECTION = {
  accelerating: { label: language.status.improving, glyph: "▲", tone: "text-positive" },
  steady: { label: language.status.holding, glyph: "▶", tone: "text-accent" },
  slipping: { label: language.status.slipping, glyph: "▼", tone: "text-caution" },
  stalled: { label: language.status.stalled, glyph: "■", tone: "text-negative" },
} as const;
const RISK_TONE = { low: "positive", elevated: "caution", high: "negative", critical: "critical" } as const;

function Row({ label, children, emphasis }: { label: string; children: React.ReactNode; emphasis?: boolean }) {
  return <div className={cn("flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border/50 py-2.5 last:border-b-0", emphasis && "border-b-0")}>
    <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{label}</dt>
    <dd className={cn("text-right", emphasis ? "text-base" : "text-sm")}>{children}</dd>
  </div>;
}

export function StateReadout({ state }: { state: TrajectoryState }) {
  const direction = DIRECTION[state.trajectory];
  const outlook = state.outlook;
  const action = state.recommendedAction;
  const momentumRising = state.signals.projectMomentum.filter((item) => item.delta > 0).length >= state.signals.projectMomentum.filter((item) => item.delta < 0).length;
  const changePct = outlook ? outlook.expectedTrajectoryChange * 100 : null;

  return <section className="rounded-xl border border-border-strong bg-surface/80 p-5 md:p-6">
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
      <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-foreground">{language.brand.name}</h1>
      <div className="flex items-center gap-2">
        <Badge tone={RISK_TONE[state.riskLevel]}>{state.riskLevel}</Badge>
        {outlook ? <Badge tone={outlook.calibration === "calibrated" ? "positive" : "neutral"}>{outlook.calibration}</Badge> : null}
      </div>
    </div>
    <dl>
      <Row label={language.trajectory.currentTrajectory} emphasis><span className={cn("font-medium", direction.tone)}>{direction.glyph} {direction.label}</span></Row>
      <Row label={language.trajectory.confidence}>{outlook ? <div className="flex items-center justify-end gap-2"><span className="font-mono text-caution">{Math.round(outlook.confidence * 100)}%</span><span className="text-[11px] text-faint">{outlook.horizonDays}d</span></div> : <span className="text-faint">—</span>}</Row>
      <Row label={language.trajectory.currentConstraint}>{state.bottleneck ? <span className="text-foreground">{state.bottleneck.title}</span> : <span className="text-faint">{language.trajectory.nothingBlocking}</span>}</Row>
      <Row label={language.trajectory.momentum}><span className={momentumRising ? "text-positive" : "text-caution"}>{momentumRising ? language.status.increasing : language.status.softening}</span></Row>
      <Row label={language.headings.highestLeverageAction} emphasis><span className="font-medium text-accent">{action?.title ?? language.trajectory.nothingActionable}</span></Row>
      <Row label={language.trajectory.expectedTrajectoryChange}>{changePct === null ? <span className="text-faint">—</span> : <div className="flex items-center justify-end gap-2"><span className={cn("font-mono", outlook?.withinNoise ? "text-faint" : changePct >= 0 ? "text-positive" : "text-negative")}>{changePct >= 0 ? "+" : ""}{changePct.toFixed(0)}%</span>{outlook?.withinNoise ? <span className="text-[11px] text-faint">{language.status.withinNoise}</span> : <span className="text-[11px] text-faint">±{Math.round((outlook?.standardError ?? 0) * 100)}%</span>}</div>}</Row>
    </dl>
    {outlook ? <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
      {outlook.objectiveOutlook.map((item) => <div key={item.label}><div className="flex items-baseline justify-between gap-2"><span className="truncate text-xs text-muted">{item.label}</span><span className="font-mono text-xs text-faint">{Math.round(item.onTrack * 100)}%</span></div><div className="mt-1"><Meter value={item.onTrack} tone={item.onTrack > 0.7 ? "positive" : item.onTrack > 0.4 ? "caution" : "negative"} /></div></div>)}
      <p className="pt-1 text-[10px] leading-relaxed text-faint">{outlook.trajectories} simulated trajectories · {outlook.horizonDays} days · seed {outlook.seed}.{outlook.calibration !== "calibrated" ? ` ${language.trajectory.uncalibratedNotice}` : ""}</p>
    </div> : null}
  </section>;
}

export function DecayStrip({ state }: { state: TrajectoryState }) {
  const decay = state.outlook?.decay ?? [];
  if (!decay.length || !state.recommendedAction) return null;
  const now = state.outlook?.expectedTrajectoryChange ?? 0;
  const denominator = Math.abs(now) || 1;
  return <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{language.trajectory.costOfDelay}</p>
    <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2"><span className="text-sm text-foreground">{language.trajectory.now} <span className="font-mono text-positive">100%</span></span>
      {decay.map((item) => { const retained = denominator ? (item.expectedDelta / (now || 1)) * 100 : 0; return <span key={item.days} className="text-sm text-muted">+{item.days}d <span className={cn("font-mono", retained >= 80 ? "text-positive" : retained >= 40 ? "text-caution" : "text-negative")}>{Math.max(0, Math.round(retained))}%</span></span>; })}
      <span className="text-[11px] text-faint">{language.trajectory.retainedValue}</span>
    </div>
  </div>;
}
