import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import {
  NoProviderConfiguredError,
  ProviderNarrativeSchema,
  ProviderRequestError,
  ProviderUnavailableError,
  providerOptions,
  providerPreferences,
  resolveProvider,
  type ProviderPreference,
} from "@/lib/providers";
import { computeState } from "@/lib/state/compute";
import { getCurrentUser } from "@/lib/auth/session";
import { getWorkspaceRepository } from "@/lib/workspace/repository";
import { checkInContext, getPersonalProfile, getTodayCheckIn } from "@/lib/personalization";
import { persistExecutiveSignal } from "@/lib/executive-signals";
import { providerRuntimeDiagnostics } from "@/lib/config";

export const dynamic = "force-dynamic";

const RequestBody = z.object({
  transcript: z.string().trim().min(1).max(2000),
  provider: z.string().trim().min(1),
  requestId: z.string().uuid(),
});

const SignalDraft = z.object({
  highestLeverageRecommendation: z.string().trim().min(8).max(420),
  currentObservation: z.string().trim().min(12).max(320),
  reasoning: z.string().trim().min(40).max(1200),
  expectedImpact: z.string().trim().min(12).max(320),
  confidence: z.number().min(0).max(1),
  currentConstraint: z.string().trim().min(8).max(240),
  suggestedNextAction: z.string().trim().min(6).max(180),
  urgency: z.number().min(0).max(1),
  trajectory: z.enum(["accelerating", "steady", "slipping", "stalled"]),
  riskLevel: z.enum(["low", "elevated", "high", "critical"]),
});

class StructuredSignalInvalidError extends Error {
  constructor(message = "Structured provider response was invalid") {
    super(message);
    this.name = "StructuredSignalInvalidError";
  }
}
class SignalPersistenceError extends Error {
  constructor(message = "Executive Signal persistence failed") {
    super(message);
    this.name = "SignalPersistenceError";
  }
}

const log = (event: string, detail: Record<string, unknown>) =>
  console.info("[trajectory:voice-api]", { event, at: new Date().toISOString(), ...detail });
const transcriptFingerprint = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);

function normalizeProvider(value: string): ProviderPreference {
  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, "");
  const aliases: Record<string, ProviderPreference> = {
    automatic: "auto", auto: "auto", openai: "openai", anthropic: "anthropic",
    claude: "anthropic", gemini: "gemini", google: "gemini", grok: "grok",
    xai: "grok", local: "local",
  };
  const provider = aliases[normalized];
  if (!provider || !providerPreferences.includes(provider)) throw new Error("invalid provider identifier");
  return provider;
}

function wordSet(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
function overlap(a: string, b: string) {
  const first = wordSet(a); const second = wordSet(b);
  if (!first.size || !second.size) return 0;
  let shared = 0;
  for (const word of first) if (second.has(word)) shared += 1;
  return shared / Math.min(first.size, second.size);
}

function validateCoherence(narrative: z.infer<typeof ProviderNarrativeSchema>, transcript: string) {
  const action = narrative.recommendedAction.title.trim();
  const reasoning = narrative.reasoning.trim();
  const constraint = narrative.currentConstraint.trim();
  const expected = narrative.expectedImpact.trim();
  const next = narrative.suggestedNextAction.trim();
  const combined = `${transcript} ${action}`.toLowerCase();
  const invalidGeneric = [
    "continue observing your trajectory",
    "your calendar is clear",
    "advance the highest-value path",
    "no material constraint is blocking movement",
    "within the model’s noise floor",
    "within the model's noise floor",
    "awaiting sufficient measurement",
  ];
  const fields = [action, narrative.currentObservation, reasoning, constraint, expected, next];
  if (fields.some((field) => invalidGeneric.some((phrase) => field.toLowerCase().includes(phrase)))) {
    throw new StructuredSignalInvalidError("Placeholder-like content was returned");
  }
  if (/^\s*(current state|current dynamics|expected shift)\s*:/i.test(reasoning) ||
      /commercial momentum\s+[-\d.]+\s+with delta/i.test(reasoning) ||
      /events in the last 24h/i.test(reasoning)) {
    throw new StructuredSignalInvalidError("Raw runtime state was returned as user-facing reasoning");
  }
  if (overlap(action, next) > 0.72) {
    throw new StructuredSignalInvalidError("Suggested next action duplicated the recommendation");
  }
  if (narrative.confidence === 0 && !/zero confidence|insufficient evidence|cannot assess/i.test(reasoning)) {
    throw new StructuredSignalInvalidError("Zero confidence was not explicitly justified");
  }
  const identifiesConstraint = /block|blocked|pending|waiting|acceptance|approval|constraint|hold|stuck|open branch/.test(combined);
  if (identifiesConstraint && /^(none|no |nothing)|no material|not blocking/i.test(constraint.toLowerCase())) {
    throw new StructuredSignalInvalidError("Constraint contradicted the recommendation");
  }
  if (overlap(reasoning, action) < 0.08 && !/because|therefore|unlocks|reduces|prevents|allows|so that|which means/i.test(reasoning)) {
    throw new StructuredSignalInvalidError("Reasoning did not explain the action mechanism");
  }
  return narrative;
}

function systemPrompt(ownerName: string) {
  return `You are Trajectory, ${ownerName}'s persistent executive intelligence. Return one complete, internally coherent Executive Signal.

Every displayed field is provider-authored and must agree with every other field:
- recommendedAction.title: the single highest-leverage action.
- currentObservation: concise user-facing description of the present state.
- currentConstraint: the specific active constraint implied by the recommendation; never say none when the action resolves a blocker.
- expectedImpact: the concrete shift expected if the action is completed; never use a noise-floor or awaiting-measurement placeholder.
- reasoning: concise user-facing logic explaining why this action follows from user-reported state, observed activity and inferred trajectory. Do not serialize raw runtime fields or include headings.
- confidence: 0 to 1. Do not return zero unless the reasoning explicitly explains why confidence is zero.
- suggestedNextAction: a short, immediately executable first step; it must not repeat the full recommendation.
- urgency: 0 to 1.

Use British English. Do not expose internal model activity, raw JSON, hidden reasoning or diagnostics. Treat wellbeing as self-reported operating context, never a diagnosis.`;
}

function speechFor(draft: z.infer<typeof SignalDraft>, why: string) {
  return `${draft.highestLeverageRecommendation}. ${why} Next: ${draft.suggestedNextAction}.`;
}

function classify(error: unknown) {
  if (error instanceof NoProviderConfiguredError) return { code: "no_provider_configured", stage: "provider_resolution", status: 503, userMessage: "Trajectory has no reasoning provider configured for this preview." };
  if (error instanceof ProviderUnavailableError) return { code: "provider_unavailable", stage: "provider_resolution", status: 503, userMessage: language.errors.providerUnavailable };
  if (error instanceof ProviderRequestError) return { code: "provider_rejected_request", stage: "provider_request", status: 502, userMessage: "Trajectory’s reasoning provider could not complete this request. Try again shortly." };
  if (error instanceof StructuredSignalInvalidError || error instanceof z.ZodError) return { code: "structured_response_invalid", stage: "structured_validation", status: 502, userMessage: "Trajectory received an incomplete or inconsistent signal. Your previous signal has been preserved." };
  if (error instanceof SignalPersistenceError) return { code: "persistence_failed", stage: "persistence", status: 500, userMessage: "Trajectory prepared a signal but could not preserve it. Your previous signal remains unchanged." };
  return { code: "generation_failed", stage: "generation", status: 500, userMessage: language.errors.voiceBrief };
}

async function createBriefing(input: z.infer<typeof RequestBody>) {
  const startedAt = Date.now();
  let repository: Awaited<ReturnType<typeof getWorkspaceRepository>> | undefined;
  let conversationId: string | undefined;
  const evidence = { requestId: input.requestId, transcriptLength: input.transcript.length, transcriptFingerprint: transcriptFingerprint(input.transcript) };
  try {
    const [user, workspace] = await Promise.all([getCurrentUser(), getWorkspaceRepository()]);
    repository = workspace;
    if (!user) throw new Error("authentication required");
    log("route_reached", { ...evidence, userId: user.id });

    const profile = await getPersonalProfile();
    const morningCheckIn = await getTodayCheckIn(profile);
    const settings = await repository.getSettings();
    const recentMessages = await repository.recentMessages(16);
    const requestedProvider = input.provider || profile.provider || settings.provider;
    const selectedProvider = normalizeProvider(requestedProvider);
    const eligible = providerOptions().find((option) => option.id === selectedProvider);
    const runtime = providerRuntimeDiagnostics(requestedProvider);
    if (selectedProvider !== "auto" && (!eligible?.configured || !eligible.capabilities.includes("executive_reasoning"))) {
      throw new ProviderUnavailableError(selectedProvider);
    }
    const provider = resolveProvider(selectedProvider);
    if (!provider) throw new NoProviderConfiguredError();

    const conversation = await repository.createConversation(input.transcript.slice(0, 72), provider.id);
    conversationId = conversation.id;
    await repository.appendMessage({
      conversationId,
      role: "user",
      content: input.transcript,
      metadata: { channel: "voice", requestId: input.requestId, transcriptFingerprint: evidence.transcriptFingerprint, requestedProvider, normalizedProvider: selectedProvider },
    });

    const state = await computeState({ persist: true, deterministicOnly: true, ownerName: profile.displayName });
    const continuity = [
      checkInContext(morningCheckIn),
      `Personalisation: involvement ${profile.involvementLevel}; priority areas ${profile.priorityAreas.join(", ") || "not set"}.`,
      recentMessages.map((message) => `${message.role}: ${message.content}`).join("\n").slice(-6000),
    ].filter(Boolean).join("\n\n");
    const stateEvidence = `Direction: ${state.trajectory}. Risk: ${state.riskLevel}. Current bottleneck: ${state.bottleneck?.title ?? "none recorded"}. Recent platform activity: ${state.signals.eventsLast24h} events in the last 24 hours. User request: ${input.transcript}.`;

    log("provider_request_starting", { ...evidence, requestedProvider, normalizedProvider: selectedProvider, provider: provider.id, resolvedModel: provider.model, providerRequestAttempted: true, vercelEnv: runtime.vercelEnv });
    let response;
    try {
      response = await provider.generate({
        systemPrompt: systemPrompt(profile.displayName),
        prompt: `${stateEvidence}\n\n${continuity}\n\nReturn the complete structured Executive Signal. Keep suggestedNextAction shorter than recommendedAction.title.`,
      });
    } catch (error) {
      throw new ProviderRequestError(provider.id, provider.model, error instanceof Error ? error.name : "UnknownError", error instanceof Error ? error.message : "Provider request failed");
    }
    log("provider_completed", { ...evidence, provider: provider.id, model: response.model, providerRequestId: response.requestId ?? null, latencyMs: Date.now() - startedAt });

    const narrative = validateCoherence(ProviderNarrativeSchema.parse(response.narrative), input.transcript);
    const draft = SignalDraft.parse({
      highestLeverageRecommendation: narrative.recommendedAction.title,
      currentObservation: narrative.currentObservation,
      reasoning: narrative.reasoning,
      expectedImpact: narrative.expectedImpact,
      confidence: narrative.confidence,
      currentConstraint: narrative.currentConstraint,
      suggestedNextAction: narrative.suggestedNextAction,
      urgency: narrative.urgency,
      trajectory: state.trajectory,
      riskLevel: state.riskLevel,
    });
    log("structured_validation_passed", { ...evidence, providerRequestId: response.requestId ?? null });

    const sourceFingerprint = createHash("sha256").update(JSON.stringify({ requestId: input.requestId, transcriptFingerprint: evidence.transcriptFingerprint, draft })).digest("hex");
    let persisted: Awaited<ReturnType<typeof persistExecutiveSignal>>;
    try {
      persisted = await persistExecutiveSignal({
        requestId: input.requestId,
        highestLeverageRecommendation: draft.highestLeverageRecommendation,
        currentObservation: draft.currentObservation,
        reasoning: draft.reasoning,
        currentConstraint: draft.currentConstraint,
        confidence: draft.confidence,
        expectedImpact: null,
        suggestedNextAction: draft.suggestedNextAction,
        urgency: draft.urgency,
        sourceFingerprint,
        provider: provider.id,
        model: response.model,
        morningCheckInId: morningCheckIn?.id,
      });
    } catch {
      throw new SignalPersistenceError();
    }

    const signal = { id: persisted.id, computedAt: persisted.generated_at, ...draft };
    const speech = speechFor(draft, narrative.recommendedAction.why);
    await repository.appendMessage({
      conversationId,
      role: "assistant",
      content: draft.reasoning,
      provider: provider.id,
      model: response.model,
      metadata: { channel: "voice", requestId: input.requestId, providerRequestId: response.requestId ?? null, executiveSignalId: persisted.id, executiveSignal: signal, expectedImpact: draft.expectedImpact },
    });
    await Promise.all([
      repository.recordVoice({ conversationId, transcript: input.transcript, responseText: speech, provider: provider.id, model: response.model, durationMs: Date.now() - startedAt, status: "completed" }),
      repository.recordTrajectory({ ...state, provider: provider.id, model: response.model, reasoning: draft.reasoning, todaysObjective: narrative.todaysObjective, recommendedAction: { title: draft.highestLeverageRecommendation, why: narrative.recommendedAction.why, leverage: state.signals.candidates[0]?.leverage ?? 0, candidateId: state.signals.candidates[0]?.id ?? input.requestId, tier: "recommend" } }),
      repository.recordProviderUsage({ provider: provider.id, model: response.model, taskType: "voice-brief", latencyMs: Date.now() - startedAt, success: true }),
    ]);
    log("persistence_completed", { ...evidence, userId: user.id, conversationId, signalId: persisted.id, providerRequestId: response.requestId ?? null });
    return NextResponse.json({ requestId: input.requestId, speech, signal, conversationId, diagnostics: { provider: provider.id, model: response.model, providerRequestId: response.requestId ?? null, persisted: true } });
  } catch (error) {
    const failure = classify(error);
    if (repository) await repository.recordVoice({ conversationId, transcript: input.transcript, durationMs: Date.now() - startedAt, status: "failed", errorCode: failure.code }).catch(() => undefined);
    log("response_failed", { ...evidence, status: failure.status, stage: failure.stage, failureCode: failure.code, errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: failure.userMessage, recoverable: true, requestId: input.requestId, code: failure.code }, { status: failure.status });
  }
}

export async function POST(request: Request) {
  try {
    return createBriefing(RequestBody.parse(await request.json()));
  } catch {
    return NextResponse.json({ error: language.errors.invalidRequest, recoverable: true, code: "invalid_request" }, { status: 400 });
  }
}
