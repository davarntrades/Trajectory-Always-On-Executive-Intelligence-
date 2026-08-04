import { NextResponse } from "next/server";
import { computeState } from "@/lib/state/compute";
import { runtimeMode } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Current state. `?deterministic=1` skips the model call. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deterministicOnly = url.searchParams.get("deterministic") === "1";

  try {
    const state = await computeState({ deterministicOnly, persist: true });
    return NextResponse.json({ state, mode: runtimeMode() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "state computation failed" },
      { status: 500 },
    );
  }
}
