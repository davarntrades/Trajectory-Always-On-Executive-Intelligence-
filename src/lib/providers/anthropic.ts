import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import {
  ProviderNarrativeSchema,
  type IntelligenceProvider,
  type ProviderRequest,
} from "./types";

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    todaysObjective: { type: "string" },
    reasoning: { type: "string" },
    recommendedAction: {
      type: "object",
      properties: {
        title: { type: "string" },
        why: { type: "string" },
      },
      required: ["title", "why"],
      additionalProperties: false,
    },
  },
  required: ["todaysObjective", "reasoning", "recommendedAction"],
  additionalProperties: false,
} as const;

async function requestStructuredNarrative(request: ProviderRequest) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client.messages.create({
    model: config.anthropicModel,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: NARRATIVE_SCHEMA },
    },
    system: [
      {
        type: "text",
        text: request.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: request.prompt }],
  });
}

export async function probeAnthropicProvider() {
  const response = await requestStructuredNarrative({
    systemPrompt: "Return the requested structured object only.",
    prompt: "Return a minimal valid trajectory narrative confirming provider availability.",
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Anthropic declined the request");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Anthropic returned no structured narrative");
  }

  ProviderNarrativeSchema.parse(JSON.parse(text.text));
  const requestId = (response as typeof response & { _request_id?: string })._request_id ?? null;

  return {
    ok: true as const,
    provider: "anthropic" as const,
    model: response.model,
    requestAttempted: true as const,
    httpStatus: 200,
    requestId,
    structuredValidationPassed: true as const,
  };
}

export const anthropicProvider: IntelligenceProvider = {
  id: "anthropic",
  label: "Claude",
  model: config.anthropicModel,
  capabilities: ["executive_reasoning", "long_context", "structured_output"],
  latency: "high",
  cost: "high",
  isConfigured: () => Boolean(config.anthropicApiKey),
  async generate(request: ProviderRequest) {
    const response = await requestStructuredNarrative(request);

    if (response.stop_reason === "refusal") {
      throw new Error("Anthropic declined the request");
    }

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("Anthropic returned no narrative");
    }

    return {
      narrative: ProviderNarrativeSchema.parse(JSON.parse(text.text)),
      model: response.model,
    };
  },
};
