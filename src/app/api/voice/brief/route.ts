import { NextResponse } from "next/server";
import { z } from "zod";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { ProviderUnavailableError, providerPreferences } from "@/lib/providers";
import { computeState } from "@/lib/state/compute";
import { buildBriefing } from "@/lib/voice/briefing";
import { getCurrentUser } from "@/lib/auth/session";
import { getWorkspaceRepository } from "@/lib/workspace/repository";

export const dynamic = "force-dynamic";

const RequestBody = z.object({
  transcript: z.string().trim().min(1).max(2000),
  provider: z.enum(providerPreferences),
  requestId: z.string().uuid(),
});

const ExecutiveSignal = z.object({
  computedAt: z.string().datetime(),
  highestLeverageRecommendation: z.string().trim().min(1),
  currentObservation: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
  expectedImpact: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  currentConstraint: z.string().trim().min(1),
  suggestedNextAction: z.string().trim().min(1),
  urgency: z.number().min(0).max(1),
  trajectory: z.enum(["accelerating", "steady", "slipping", "stalled"]),
  riskLevel: z.enum(["low", "elevated", "high", "critical"]),
});

function observation(direction: z.infer<typeof ExecutiveSignal>["trajectory"]) {
  if (direction === "accelerating") return language.trajectory.accelerating;
  if (direction === "steady") return language.trajectory.steady;
  if (direction === "slipping") return language.trajectory.slipping;
  return language.trajectory.stalled;
}

function impact(change: number | undefined, days: number | undefined, withinNoise: boolean | undefined) {
  if (change === undefined || days === undefined) return language.trajectory.awaitingMeasurement;
  if (withinNoise) return language.trajectory.withinNoise;
  return language.experience.expectedShift(Math.round(change * 100), days);
}

function validReasoning(reasoning: string, transcript: string) {
  const value = reasoning.trim();
  const normalised = value.toLowerCase();
  const invalid = !value
    || normalised === transcript.trim().toLowerCase()
    || /^(good (morning|afternoon|evening)|hello|hi)\b/.test(normalised)
    || normalised.includes("continue observing your trajectory");
  if (invalid) throw new Error("invalid executive signal reasoning");
  return value;
}

async function createBriefing(input?: z.infer<typeof RequestBody>) {
  const startedAt = Date.now();
  let repository: Awaited<ReturnType<typeof getWorkspaceRepository>> | undefined;
  let conversationId: string | undefined;
  try {
    const [user, workspace] = await Promise.all([getCurrentUser(), getWorkspaceRepository()]);
    repository = workspace;
    const settings = await repository.getSettings();
    const recentMessages = input ? await repository.recentMessages(16) : [];
    const provider = input?.provider ?? settings.provider;
    const conversation = input
      ? await repository.createConversation(input.transcript.slice(0, 72), provider === "auto" ? undefined : provider)
      : undefined;
    conversationId = conversation?.id;

    if (input && conversation) {
      await repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: input.transcript,
        metadata: { channel: "voice", requestId: input.requestId },
      });
    }

    const state = await computeState({
      persist: true,
      provider,
      userInput: input?.transcript,
      conversationContext: recentMessages.map((message) => `${message.role}: ${message.content}`).join("\n").slice(-8_000),
      ownerName: user?.displayName,
    });
    const briefing = await buildBriefing(state, user?.displayName);
    const top = state.signals.candidates[0];
    const signal = ExecutiveSignal.parse({
      computedAt: state.computedAt,
      highestLeverageRecommendation: state.recommendedAction?.title ?? state.todaysObjective,
      currentObservation: observation(state.trajectory),
      reasoning: validReasoning(state.reasoning || state.recommendedAction?.why || "", input?.transcript ?? ""),
      expectedImpact: impact(state.outlook?.expectedTrajectoryChange, state.outlook?.horizonDays, state.outlook?.withinNoise),
      confidence: Math.max(0, Math.min(1, state.outlook?.confidence ?? 0.5)),
      currentConstraint: state.bottleneck?.title ?? language.trajectory.noConstraint,
      suggestedNextAction: state.recommendedAction?.title ?? state.todaysObjective,
      urgency: Math.max(0, Math.min(1, top?.urgency ?? 0.5)),
      trajectory: state.trajectory,
      riskLevel: state.riskLevel,
    });

    if (input && conversation) {
      await repository.appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: signal.reasoning,
        provider: state.provider,
        model: state.model,
        metadata: { channel: "voice", requestId: input.requestId, executiveSignal: signal },
      });
      await Promise.all([
        repository.recordVoice({
          conversationId: conversation.id,
          transcript: input.transcript,
          responseText: briefing.speech,
          provider: state.provider,
          model: state.model,
          durationMs: Date.now() - startedAt,
          status: "completed",
        }),
        repository.recordTrajectory(state),
        ...(state.provider && state.model ? [repository.recordProviderUsage({
          provider: state.provider,
          model: state.model,
          taskType: "voice-brief",
          latencyMs: Date.now() - startedAt,
          success: true,
        })] : []),
      ]);
    }

    return NextResponse.json({
      requestId: input?.requestId ?? null,
      speech: briefing.speech,
      lines: briefing.lines,
      signal,
      conversationId: conversation?.id ?? null,
    });
  } catch (error) {
    if (input && repository) {
      await repository.recordVoice({
        conversationId,
        transcript: input.transcript,
        durationMs: Date.now() - startedAt,
        status: "failed",
        errorCode: error instanceof ProviderUnavailableError ? "provider_unavailable" : "generation_failed",
      }).catch(() => undefined);
    }
    if (error instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: language.errors.providerUnavailable, recoverable: true }, { status: 503 });
    }
    console.error("voice briefing failed", error);
    return NextResponse.json({ error: language.errors.voiceBrief, recoverable: true }, { status: 500 });
  }
}

export async function GET() { return createBriefing(); }
export async function POST(request: Request) {
  try {
    return createBriefing(RequestBody.parse(await request.json()));
  } catch {
    return NextResponse.json({ error: language.errors.invalidRequest, recoverable: true }, { status: 400 });
  }
}
