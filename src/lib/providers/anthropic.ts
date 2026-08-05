import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import { ProviderNarrativeSchema, type IntelligenceProvider, type ProviderRequest } from "./types";

// Keep the provider-side schema limited to constraints accepted by Anthropic's
// structured-output API. Length and semantic constraints remain enforced once,
// after the response, by ProviderNarrativeSchema.
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
    currentObservation: { type: "string" },
    currentConstraint: { type: "string" },
    expectedImpact: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    suggestedNextAction: { type: "string" },
    urgency: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "todaysObjective",
    "reasoning",
    "recommendedAction",
    "currentObservation",
    "currentConstraint",
    "expectedImpact",
    "confidence",
    "suggestedNextAction",
    "urgency",
  ],
  additionalProperties: false,
} as const;

async function requestStructuredNarrative(request: ProviderRequest) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
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

  if (response.stop_reason === "refusal") {
    throw new Error("Anthropic declined the request");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Anthropic returned no structured narrative");
  }

  return {
    narrative: ProviderNarrativeSchema.parse(JSON.parse(text.text)),
    model: response.model,
    requestId:
      (response as typeof response & { _request_id?: string })._request_id ?? null,
  };
}

export async function probeAnthropicProvider() {
  const response = await requestStructuredNarrative({
    systemPrompt:
      "Return a minimal valid Trajectory Executive Signal for a connectivity check. Do not include private data.",
    prompt:
      "Return one concise signal confirming the provider path is available. Use confidence and urgency values between 0 and 1.",
  });

  return {
    ok: true as const,
    provider: "anthropic" as const,
    model: response.model,
    requestAttempted: true as const,
    httpStatus: 200,
    requestId: response.requestId,
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
    return {
      narrative: response.narrative,
      model: response.model,
      requestId: response.requestId,
    };
  },
};
