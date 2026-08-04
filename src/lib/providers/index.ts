import { config } from "@/lib/config";
import { anthropicProvider } from "./anthropic";
import { openAIProvider } from "./openai";
import {
  ProviderUnavailableError,
  providerIds,
  type IntelligenceProvider,
  type ProviderId,
  type ProviderOption,
  type ProviderPreference,
} from "./types";

export * from "./types";

const providers: Record<ProviderId, IntelligenceProvider> = {
  anthropic: anthropicProvider,
  openai: openAIProvider,
};

export function providerOptions(): ProviderOption[] {
  return providerIds.map((id) => ({
    id,
    label: providers[id].label,
    model: providers[id].model,
    configured: providers[id].isConfigured(),
  }));
}

export function resolveProvider(
  preference: ProviderPreference = config.defaultProvider,
): IntelligenceProvider | null {
  if (preference !== "auto") {
    const requested = providers[preference];
    if (!requested.isConfigured()) throw new ProviderUnavailableError(preference);
    return requested;
  }

  const preferred = providers[config.defaultProvider === "auto" ? "anthropic" : config.defaultProvider];
  if (preferred.isConfigured()) return preferred;
  return providerIds.map((id) => providers[id]).find((provider) => provider.isConfigured()) ?? null;
}
