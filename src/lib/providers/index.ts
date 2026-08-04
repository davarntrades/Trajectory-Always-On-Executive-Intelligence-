import { config } from "@/lib/config";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { grokProvider } from "./grok";
import { localProvider } from "./local";
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
  gemini: geminiProvider,
  grok: grokProvider,
  local: localProvider,
};

export function providerOptions(): ProviderOption[] {
  return providerIds.map((id) => ({
    id,
    label: providers[id].label,
    model: providers[id].model,
    configured: providers[id].isConfigured(),
    capabilities: providers[id].capabilities,
  }));
}

export function resolveProvider(
  preference: ProviderPreference = config.defaultProvider,
  requiredCapability: import("./types").ProviderCapability = "executive_reasoning",
): IntelligenceProvider | null {
  if (preference !== "auto") {
    const requested = providers[preference];
    if (!requested.isConfigured()) throw new ProviderUnavailableError(preference);
    return requested;
  }

  const candidates = providerIds
    .map((id) => providers[id])
    .filter((provider) =>
      provider.isConfigured() && provider.capabilities.includes(requiredCapability),
    );

  if (config.defaultProvider !== "auto") {
    const preferred = providers[config.defaultProvider];
    if (candidates.includes(preferred)) return preferred;
  }

  const rank = (provider: IntelligenceProvider) => {
    const latency = { low: 3, medium: 2, high: 1 }[provider.latency];
    const cost = { low: 3, medium: 2, high: 1 }[provider.cost];
    const reasoning = provider.capabilities.includes("long_context") ? 1 : 0;
    const privacy = provider.capabilities.includes("local_private") ? 0.5 : 0;
    return latency + cost + reasoning + privacy;
  };
  return candidates.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}
