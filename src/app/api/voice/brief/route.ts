import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { ProviderUnavailableError, providerPreferences } from "@/lib/providers";
import { computeState } from "@/lib/state/compute";
import { getCurrentUser } from "@/lib/auth/session";
import { getWorkspaceRepository } from "@/lib/workspace/repository";
import { checkInContext, getPersonalProfile, getTodayCheckIn } from "@/lib/personalization";
import { persistExecutiveSignal } from "@/lib/executive-signals";

export const dynamic = "force-dynamic";

const RequestBody = z.object({ transcript: z.string().trim().min(1).max(2000), provider: z.enum(providerPreferences), requestId: z.string().uuid() });
const SignalDraft = z.object({
  highestLeverageRecommendation: z.string().trim().min(8), currentObservation: z.string().trim().min(8), reasoning: z.string().trim().min(24), expectedImpact: z.string().trim().min(8), confidence: z.number().min(0).max(1), currentConstraint: z.string().trim().min(3), suggestedNextAction: z.string().trim().min(8), urgency: z.number().min(0).max(1), trajectory: z.enum(["accelerating", "steady", "slipping", "stalled"]), riskLevel: z.enum(["low", "elevated", "high", "critical"]),
});

const log = (event: string, detail: Record<string, unknown>) => console.info("[trajectory:voice-api]", { event, at: new Date().toISOString(), ...detail });
const transcriptFingerprint = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);
function observation(direction: z.infer<typeof SignalDraft>["trajectory"]) { return direction === "accelerating" ? language.trajectory.accelerating : direction === "steady" ? language.trajectory.steady : direction === "slipping" ? language.trajectory.slipping : language.trajectory.stalled; }
function impact(change: number | undefined, days: number | undefined, withinNoise: boolean | undefined) { if (change === undefined || days === undefined) return language.trajectory.awaitingMeasurement; if (withinNoise) return language.trajectory.withinNoise; return language.experience.expectedShift(Math.round(change * 100), days); }
function wordSet(value: string) { return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []); }
function overlap(a: string, b: string) { const first = wordSet(a); const second = wordSet(b); if (!first.size || !second.size) return 0; let shared = 0; for (const word of first) if (second.has(word)) shared += 1; return shared / Math.min(first.size, second.size); }
function validReasoning(reasoning: string, transcript: string, action: string) {
  const value = reasoning.trim(); const normalised = value.toLowerCase();
  const invalidPhrases = ["continue observing your trajectory", "your calendar is clear", "advance the highest-value path", "no material constraint is blocking movement"];
  const greeting = /\b(good\s+)?(morning|afternoon|evening)\b|^hello\b|^hi\b/i.test(value);
  const explainsAction = overlap(value, action) >= .12 || /because|therefore|unlocks|reduces|prevents|allows|so that|which means/i.test(value);
  if (value.length < 24 || greeting || invalidPhrases.some((phrase) => normalised.includes(phrase)) || normalised === transcript.trim().toLowerCase() || overlap(value, transcript) > .88 || !explainsAction) throw new Error("invalid executive signal reasoning");
  return value;
}
function speechFor(signal: z.infer<typeof SignalDraft>) { return `${signal.highestLeverageRecommendation}. ${signal.reasoning} Next: ${signal.suggestedNextAction}.`; }

async function createBriefing(input: z.infer<typeof RequestBody>) {
  const startedAt = Date.now(); let repository: Awaited<ReturnType<typeof getWorkspaceRepository>> | undefined; let conversationId: string | undefined;
  const evidence = { requestId: input.requestId, transcriptLength: input.transcript.length, transcriptFingerprint: transcriptFingerprint(input.transcript) };
  try {
    const [user, workspace] = await Promise.all([getCurrentUser(), getWorkspaceRepository()]); repository = workspace;
    if (!user) throw new Error("authentication required");
    log("route_reached", { ...evidence, userId: user.id });
    const profile = await getPersonalProfile(); const morningCheckIn = await getTodayCheckIn(profile); const settings = await repository.getSettings(); const recentMessages = await repository.recentMessages(16);
    const selectedProvider = input.provider ?? profile.provider ?? settings.provider;
    log("provider_selected", { ...evidence, userId: user.id, provider: selectedProvider });
    const conversation = await repository.createConversation(input.transcript.slice(0, 72), selectedProvider === "auto" ? undefined : selectedProvider); conversationId = conversation.id;
    await repository.appendMessage({ conversationId, role: "user", content: input.transcript, metadata: { channel: "voice", requestId: input.requestId, transcriptFingerprint: evidence.transcriptFingerprint } });
    const continuity = [checkInContext(morningCheckIn), `Personalisation: involvement ${profile.involvementLevel}; priority areas ${profile.priorityAreas.join(", ") || "not set"}.`, recentMessages.map((message) => `${message.role}: ${message.content}`).join("\n").slice(-8_000)].filter(Boolean).join("\n\n");
    const state = await computeState({ persist: true, provider: selectedProvider, userInput: input.transcript, conversationContext: continuity, ownerName: profile.displayName });
    if (!state.provider || !state.model) { log("provider_failed", { ...evidence, selectedProvider, reason: "no_provider_result" }); if (selectedProvider !== "auto") throw new ProviderUnavailableError(selectedProvider); throw new Error("automatic provider unavailable"); }
    log("provider_completed", { ...evidence, provider: state.provider, model: state.model, latencyMs: Date.now() - startedAt });
    const top = state.signals.candidates[0]; const action = state.recommendedAction?.title ?? state.todaysObjective;
    let draft: z.infer<typeof SignalDraft>;
    try {
      draft = SignalDraft.parse({ highestLeverageRecommendation: action, currentObservation: observation(state.trajectory), reasoning: validReasoning(state.reasoning || state.recommendedAction?.why || "", input.transcript, action), expectedImpact: impact(state.outlook?.expectedTrajectoryChange, state.outlook?.horizonDays, state.outlook?.withinNoise), confidence: Math.max(0, Math.min(1, state.outlook?.confidence ?? .5)), currentConstraint: state.bottleneck?.title ?? language.trajectory.noConstraint, suggestedNextAction: action, urgency: Math.max(0, Math.min(1, top?.urgency ?? .5)), trajectory: state.trajectory, riskLevel: state.riskLevel });
      log("structured_validation_passed", evidence);
    } catch (error) { log("structured_validation_failed", { ...evidence, reason: error instanceof Error ? error.name : "unknown" }); throw error; }
    const sourceFingerprint = createHash("sha256").update(JSON.stringify({ requestId: input.requestId, transcriptFingerprint: evidence.transcriptFingerprint, draft })).digest("hex");
    const persisted = await persistExecutiveSignal({ requestId: input.requestId, highestLeverageRecommendation: draft.highestLeverageRecommendation, currentObservation: draft.currentObservation, reasoning: draft.reasoning, currentConstraint: draft.currentConstraint, confidence: draft.confidence, expectedImpact: state.outlook?.expectedTrajectoryChange ?? null, suggestedNextAction: draft.suggestedNextAction, urgency: draft.urgency, sourceFingerprint, provider: state.provider, model: state.model, morningCheckInId: morningCheckIn?.id });
    const signal = { id: persisted.id, computedAt: persisted.generated_at, ...draft }; const speech = speechFor(draft);
    await repository.appendMessage({ conversationId, role: "assistant", content: draft.reasoning, provider: state.provider, model: state.model, metadata: { channel: "voice", requestId: input.requestId, executiveSignalId: persisted.id, executiveSignal: signal } });
    await Promise.all([repository.recordVoice({ conversationId, transcript: input.transcript, responseText: speech, provider: state.provider, model: state.model, durationMs: Date.now() - startedAt, status: "completed" }), repository.recordTrajectory(state), repository.recordProviderUsage({ provider: state.provider, model: state.model, taskType: "voice-brief", latencyMs: Date.now() - startedAt, success: true })]);
    log("persistence_completed", { ...evidence, userId: user.id, conversationId, signalId: persisted.id });
    log("response_completed", { ...evidence, status: 200, signalId: persisted.id, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ requestId: input.requestId, speech, signal, conversationId, diagnostics: { provider: state.provider, persisted: true } });
  } catch (error) {
    if (repository) await repository.recordVoice({ conversationId, transcript: input.transcript, durationMs: Date.now() - startedAt, status: "failed", errorCode: error instanceof ProviderUnavailableError ? "provider_unavailable" : "generation_failed" }).catch(() => undefined);
    const status = error instanceof ProviderUnavailableError ? 503 : 500;
    log("response_failed", { ...evidence, status, stage: error instanceof ProviderUnavailableError ? "provider" : "validation_or_persistence", errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: error instanceof ProviderUnavailableError ? language.errors.providerUnavailable : language.errors.voiceBrief, recoverable: true, requestId: input.requestId }, { status });
  }
}

export async function POST(request: Request) { try { return createBriefing(RequestBody.parse(await request.json())); } catch { return NextResponse.json({ error: language.errors.invalidRequest, recoverable: true }, { status: 400 }); } }
