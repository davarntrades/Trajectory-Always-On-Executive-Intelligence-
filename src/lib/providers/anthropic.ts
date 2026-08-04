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

export const anthropicProvider: IntelligenceProvider = {
  id: "anthropic",
  label: "Claude",
  model: config.anthropicModel,
  isConfigured: () => Boolean(config.anthropicApiKey),
  async generate(request: ProviderRequest) {
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
      throw new Error("Anthropic returned no narrative");
    }

    return {
      narrative: ProviderNarrativeSchema.parse(JSON.parse(text.text)),
      model: response.model,
    };
  },
};
