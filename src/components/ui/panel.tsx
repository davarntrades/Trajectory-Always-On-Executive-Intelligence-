import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "accent" | "warning";
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border bg-surface/70 backdrop-blur-sm",
        tone === "default" && "border-border",
        tone === "accent" && "border-accent/40 bg-accent/[0.04]",
        tone === "warning" && "border-caution/40 bg-caution/[0.04]",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-faint">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="flex-1 px-4 py-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-faint">{children}</p>;
}

const TONES = {
  neutral: "border-border-strong text-muted",
  accent: "border-accent/50 bg-accent/10 text-accent",
  positive: "border-positive/50 bg-positive/10 text-positive",
  caution: "border-caution/50 bg-caution/10 text-caution",
  negative: "border-negative/50 bg-negative/10 text-negative",
  critical: "border-critical/60 bg-critical/15 text-critical",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Horizontal 0..1 meter. Used for momentum and confidence readings. */
export function Meter({
  value,
  tone = "accent",
}: {
  value: number;
  tone?: "accent" | "positive" | "caution" | "negative";
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const colour = {
    accent: "bg-accent",
    positive: "bg-positive",
    caution: "bg-caution",
    negative: "bg-negative",
  }[tone];
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-border">
      <div className={cn("h-full rounded-full", colour)} style={{ width: `${pct}%` }} />
    </div>
  );
}
