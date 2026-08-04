import { NextResponse } from "next/server";
import { runLoop } from "@/lib/loop";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Notification history — what Trajectory has said, and when. */
export async function GET() {
  const notifications = await (await getStore()).notifications(50);
  return NextResponse.json({ notifications });
}

/**
 * Run one pass of the continuous executive loop.
 *
 * In production this is driven by connector webhooks and a scheduled tick; the
 * body of the work is identical either way. `?observe=0` skips the connector
 * pull when the caller has already ingested (e.g. the events route).
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const observe = url.searchParams.get("observe") !== "0";
  const force = url.searchParams.get("brief");
  const alwaysNotify = url.searchParams.get("always") === "1";

  const forceBrief =
    force === "morning" || force === "midday" || force === "evening"
      ? force
      : undefined;

  try {
    const result = await runLoop({ observe, forceBrief, alwaysNotify });
    return NextResponse.json({
      ranAt: result.ranAt,
      observed: result.observed,
      decision: result.decision,
      durationMs: result.durationMs,
      delta: result.delta,
      interrupt: result.interrupt ?? null,
      brief: result.brief ?? null,
      trajectory: result.state.trajectory,
      riskLevel: result.state.riskLevel,
      recommendedAction: result.state.recommendedAction ?? null,
      outlook: result.state.outlook ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "loop failed" },
      { status: 500 },
    );
  }
}
