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
});

async function createBriefing(input?: z.infer<typeof RequestBody>) {
  const startedAt = Date.now();
  try {
    const [user, repository] = await Promise.all([getCurrentUser(), getWorkspaceRepository()]);
    const settings = await repository.getSettings();
    const recentMessages = input ? await repository.recentMessages(16) : [];
    const provider = input?.provider ?? settings.provider;
    const conversation = input
      ? await repository.createConversation(input.transcript.slice(0, 72), provider === "auto" ? undefined : provider)
      : undefined;

    if (input && conversation) {
      await repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: input.transcript,
        metadata: { channel: "voice" },
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

    if (input && conversation) {
      await repository.appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: briefing.speech,
        provider: state.provider,
        model: state.model,
        metadata: { channel: "voice", trajectory: state.trajectory },
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
      ...briefing,
      provider: state.provider ?? "deterministic",
      model: state.model ?? null,
      conversationId: conversation?.id ?? null,
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: language.errors.providerUnavailable, provider: error.providerId }, { status: 503 });
    }
    console.error("voice briefing failed", error);
    return NextResponse.json({ error: language.errors.voiceBrief }, { status: 500 });
  }
}

export async function GET() { return createBriefing(); }
export async function POST(request: Request) {
  try {
    return createBriefing(RequestBody.parse(await request.json()));
  } catch {
    return NextResponse.json({ error: language.errors.invalidRequest }, { status: 400 });
  }
}
