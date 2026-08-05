import { z } from "zod";

export const providerIds = ["anthropic", "openai", "gemini", "grok", "local"] as const;
export const providerPreferences = [...providerIds, "auto"] as const;

export type ProviderId = (typeof providerIds)[number];
export type ProviderPreference = (typeof providerPreferences)[number];

export const ProviderNarrativeSchema = z.object({
  todaysObjective: z.string().trim().min(8).max(420),
  reasoning: z.string().trim().min(40).max(1200),
  recommendedAction: z.object({
    title: z.string().trim().min(8).max(420),
    why: z.string().trim().min(20).max(600),
  }),
  currentObservation: z.string().trim().min(12).max(320),
  currentConstraint: z.string().trim().min(8).max(240),
  expectedImpact: z.string().trim().min(12).max(320),
  confidence: z.number().min(0).max(1),
  suggestedNextAction: z.string().trim().min(6).max(180),
  urgency: z.number().min(0).max(1),
});

export type ProviderNarrative = z.infer<typeof ProviderNarrativeSchema>;

export interface ProviderRequest {
  systemPrompt: string;
  prompt: string;
}

export interface ProviderResponse {
  narrative: ProviderNarrative;
  model: string;
}

export interface IntelligenceProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly latency: "low" | "medium" | "high";
  readonly cost: "low" | "medium" | "high";
  isConfigured(): boolean;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderOption {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
  capabilities: readonly ProviderCapability[];
}

export type ProviderCapability =
  | "executive_reasoning"
  | "fast_response"
  | "long_context"
  | "structured_output"
  | "local_private";

export class NoProviderConfiguredError extends Error {
  constructor() {
    super("No executive-reasoning provider is configured for this deployment");
    this.name = "NoProviderConfiguredError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly providerId: ProviderId) {
    super(`${providerId} is not configured`);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderRequestError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly model: string,
    public readonly causeName: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}
