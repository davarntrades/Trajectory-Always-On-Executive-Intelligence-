import { z } from "zod";

export const providerIds = ["anthropic", "openai"] as const;
export const providerPreferences = [...providerIds, "auto"] as const;

export type ProviderId = (typeof providerIds)[number];
export type ProviderPreference = (typeof providerPreferences)[number];

export const ProviderNarrativeSchema = z.object({
  todaysObjective: z.string().min(1),
  reasoning: z.string().min(1),
  recommendedAction: z.object({
    title: z.string().min(1),
    why: z.string().min(1),
  }),
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
  isConfigured(): boolean;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderOption {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly providerId: ProviderId) {
    super(`${providerId} is not configured`);
    this.name = "ProviderUnavailableError";
  }
}
