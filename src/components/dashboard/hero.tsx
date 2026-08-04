/**
 * The state readout.
 *
 * Answers the four questions the homepage exists to answer, in order:
 * where am I, where am I heading, what is stopping me, what should I do next.
 *
 * Forward-looking numbers carry their calibration status inline. An
 * uncalibrated estimate rendered with the same authority as a measured signal
 * would be the single most misleading thing this interface could do.
 */

import { Badge, Meter } from "@/components/ui/panel";
import type { TrajectoryState } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIRECTION = {
  accelerating: { label: "Improving", glyph: "▲", tone: "text-positive" },
  steady: { label: "Holding", glyph: "▶", tone: "text-accent" },
  slipping: { label: "Slipping", glyph: "▼", tone: "text-caution" },
  stalled: { label: "Stalled", glyph: "■", tone: "text-negative" },
} as const;

const RISK_TONE = {
  low: "positive",
  elevated: "caution",
  high: "negative",
  critical: "critical",
} as const;

function Row({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border/50 py-2.5 last:border-b-0",
        emphasis && "border-b-0",
      )}
    >
      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        {label}
      </dt>
      <dd className={cn("text-right", emphasis ? "text-base" : "text-sm")}>
        {children}
      </dd>
    </div>
  );
}

export function StateReadout({ state }: { state: TrajectoryState }) {
  const direction = DIRECTION[state.trajectory];
  const outlook = state.outlook;
  const action = state.recommendedAction;

  const momentumRising =
    state.signals.projectMomentum.filter((m) => m.delta > 0).length >=
    state.signals.projectMomentum.filter((m) => m.delta < 0).length;

  const changePct = outlook ? outlook.expectedTrajectoryChange * 100 : null;

  return (
    <section className="rounded-xl border border-border-strong bg-surface/80 p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
          Trajectory
        </h1>
        <div className="flex items-center gap-2">
          <Badge tone={RISK_TONE[state.riskLevel]}>{state.riskLevel} risk</Badge>
          {outlook ? (
            <Badge
              tone={outlook.calibration === "calibrated" ? "positive" : "neutral"}
            >
              {outlook.calibration}
            </Badge>
          ) : null}
        </div>
      </div>

      <dl>
        <Row label="Current Trajectory" emphasis>
          <span className={cn("font-medium", direction.tone)}>
            {direction.glyph} {direction.label}
          </span>
        </Row>

        <Row label="Confidence">
          {outlook ? (
            <div className="flex items-center justify-end gap-2">
              <span className="font-mono text-caution">
                {Math.round(outlook.confidence * 100)}%
              </span>
              <span className="text-[11px] text-faint">
                {outlook.primaryObjective
                  ? `on track · ${outlook.horizonDays}d`
                  : `${outlook.horizonDays}d`}
              </span>
            </div>
          ) : (
            <span className="text-faint">—</span>
          )}
        </Row>

        <Row label="Current Constraint">
          {state.bottleneck ? (
            <span className="text-foreground">{state.bottleneck.title}</span>
          ) : (
            <span className="text-faint">Nothing blocking</span>
          )}
        </Row>

        <Row label="Momentum">
          <span className={momentumRising ? "text-positive" : "text-caution"}>
            {momentumRising ? "Increasing" : "Softening"}
          </span>
        </Row>

        <Row label="Today's Highest Leverage Action" emphasis>
          <span className="font-medium text-accent">
            {action?.title ?? "Nothing actionable"}
          </span>
        </Row>

        <Row label="Expected Trajectory Change">
          {changePct === null ? (
            <span className="text-faint">—</span>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <span
                className={cn(
                  "font-mono",
                  outlook?.withinNoise
                    ? "text-faint"
                    : changePct >= 0
                      ? "text-positive"
                      : "text-negative",
                )}
              >
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(0)}%
              </span>
              {/* An estimate inside the noise floor must not read as a finding. */}
              {outlook?.withinNoise ? (
                <span className="text-[11px] text-faint">within noise</span>
              ) : (
                <span className="text-[11px] text-faint">
                  ±{Math.round((outlook?.standardError ?? 0) * 100)}%
                </span>
              )}
            </div>
          )}
        </Row>
      </dl>

      {outlook ? (
        <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
          {outlook.objectiveOutlook.map((o) => (
            <div key={o.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-muted">{o.label}</span>
                <span className="font-mono text-xs text-faint">
                  {Math.round(o.onTrack * 100)}%
                </span>
              </div>
              <div className="mt-1">
                <Meter
                  value={o.onTrack}
                  tone={o.onTrack > 0.7 ? "positive" : o.onTrack > 0.4 ? "caution" : "negative"}
                />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[10px] leading-relaxed text-faint">
            Forward estimates from {outlook.trajectories} simulated trajectories
            over {outlook.horizonDays} days (seed {outlook.seed}).
            {outlook.calibration !== "calibrated"
              ? " No prediction has been scored against an outcome yet — treat these as ordering, not probability."
              : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Cost of delay — the claim that makes timing advice real. */
export function DecayStrip({ state }: { state: TrajectoryState }) {
  const decay = state.outlook?.decay ?? [];
  if (!decay.length || !state.recommendedAction) return null;

  const now = state.outlook?.expectedTrajectoryChange ?? 0;
  const denominator = Math.abs(now) || 1;

  return (
    <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        Cost of delay
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-sm text-foreground">
          Now <span className="font-mono text-positive">100%</span>
        </span>
        {decay.map((d) => {
          const retained = denominator ? (d.expectedDelta / (now || 1)) * 100 : 0;
          return (
            <span key={d.days} className="text-sm text-muted">
              +{d.days}d{" "}
              <span
                className={cn(
                  "font-mono",
                  retained >= 80 ? "text-positive" : retained >= 40 ? "text-caution" : "text-negative",
                )}
              >
                {Math.max(0, Math.round(retained))}%
              </span>
            </span>
          );
        })}
        <span className="text-[11px] text-faint">
          of the value this action has today
        </span>
      </div>
    </div>
  );
}
