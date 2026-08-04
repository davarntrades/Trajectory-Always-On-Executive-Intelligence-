import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "@/lib/config";
import {
  ProviderNarrativeSchema,
  type IntelligenceProvider,
  type ProviderRequest,
} from "./types";

export const openAIProvider: IntelligenceProvider = {
  id: "openai",
  label: "OpenAI",
  model: config.openaiModel,
  capabilities: ["executive_reasoning", "fast_response", "structured_output"],
  latency: "medium",
  cost: "medium",
  isConfigured: () => Boolean(config.openaiApiKey),
  async generate(request: ProviderRequest) {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.responses.parse({
      model: config.openaiModel,
      instructions: request.systemPrompt,
      input: request.prompt,
      text: {
        format: zodTextFormat(ProviderNarrativeSchema, "trajectory_narrative"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("OpenAI returned no structured narrative");
    }

    return {
      narrative: response.output_parsed,
      model: response.model,
    };
  },
};
