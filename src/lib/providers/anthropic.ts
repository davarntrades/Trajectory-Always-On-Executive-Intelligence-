import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import {
  ProviderNarrativeSchema,
  ProviderRequestError,
  describeProviderFailure,
  type IntelligenceProvider,
  type ProviderFailureDetail,
  type ProviderRequest,
} from "./types";

// Keep the provider-side schema limited to constraints accepted by Anthropic's
// structured-output API. Length, range and semantic constraints remain enforced
// after the response by ProviderNarrativeSchema.
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
    confidence: { type: "number" },
    suggestedNextAction: { type: "string" },
    urgency: { type: "number" },
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

// Adaptive thinking and the response share this budget, so it is sized well
// above the narrative itself. Streaming is required at this size: a
// non-streaming request that large risks an SDK HTTP timeout, and a budget
// tight enough to avoid that risks stopping on max_tokens mid-JSON — which
// surfaced only as an opaque parse failure.
const MAX_TOKENS = 32000;

function failure(message: string, causeName: string, detail: ProviderFailureDetail = {}) {
  return new ProviderRequestError("anthropic", config.anthropicModel, causeName, message, detail);
}

async function requestStructuredNarrative(request: ProviderRequest) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  let response;
  try {
    const stream = client.messages.stream({
      model: config.anthropicModel,
      max_tokens: MAX_TOKENS,
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
    response = await stream.finalMessage();
  } catch (error) {
    throw failure(
      error instanceof Error ? error.message : "Anthropic request failed",
      error instanceof Error ? error.name : "UnknownError",
      describeProviderFailure(error),
    );
  }

  const requestId = (response as typeof response & { _request_id?: string })._request_id ?? null;
  const base = { providerRequestId: requestId, stopReason: response.stop_reason ?? undefined };

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.type === "refusal" ? response.stop_details.category : undefined;
    throw failure("Anthropic declined the request", "AnthropicRefusal", {
      ...base,
      refusalCategory: category ?? undefined,
    });
  }
  // A truncated response yields invalid JSON, which previously looked
  // identical to a malformed one. Naming it makes the budget the suspect.
  if (response.stop_reason === "max_tokens") {
    throw failure(
      `Anthropic response was truncated at the ${MAX_TOKENS}-token ceiling`,
      "AnthropicTruncated",
      base,
    );
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw failure("Anthropic returned no structured narrative", "AnthropicEmptyResponse", base);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw failure("Anthropic returned unparseable structured output", "AnthropicMalformedJson", base);
  }

  return {
    narrative: ProviderNarrativeSchema.parse(parsed),
    model: response.model,
    requestId,
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
