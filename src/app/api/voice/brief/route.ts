import { NextResponse } from "next/server";
import { computeState } from "@/lib/state/compute";
import { buildBriefing } from "@/lib/voice/briefing";

export const dynamic = "force-dynamic";

/**
 * The spoken briefing.
 *
 * Voice and the dashboard read the same computed state, so what Trajectory says
 * out loud is always what the dashboard shows.
 */
export async function GET() {
  try {
    const state = await computeState({ persist: false });
    const briefing = await buildBriefing(state);
    return NextResponse.json(briefing);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "briefing failed" },
      { status: 500 },
    );
  }
}
