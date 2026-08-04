import { NextResponse } from "next/server";
import { z } from "zod";
import { ProviderUnavailableError, providerPreferences } from "@/lib/providers";
import { computeState } from "@/lib/state/compute";
import { buildBriefing } from "@/lib/voice/briefing";

export const dynamic = "force-dynamic";

/**
 * The spoken briefing.
 *
 * Voice and the dashboard read the same computed state, so what Trajectory says
 * out loud is always what the dashboard shows.
 */
const RequestBody = z.object({
  transcript: z.string().trim().min(1).max(2000),
  provider: z.enum(providerPreferences),
});

async function createBriefing(input?: z.infer<typeof RequestBody>) {
  try {
    const state = await computeState({
      persist: false,
      provider: input?.provider,
      userInput: input?.transcript,
    });
    const briefing = await buildBriefing(state);
    return NextResponse.json({
      ...briefing,
      provider: state.provider ?? "deterministic",
      model: state.model ?? null,
    });
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json(
        { error: err.message, provider: err.providerId },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "briefing failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return createBriefing();
}

export async function POST(request: Request) {
  try {
    const body = RequestBody.parse(await request.json());
    return createBriefing(body);
  } catch {
    return NextResponse.json(
      { error: "invalid request" },
      { status: 400 },
    );
  }
}
