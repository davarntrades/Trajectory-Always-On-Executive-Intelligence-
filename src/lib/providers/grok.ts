import OpenAI from "openai";
import { z } from "zod";
import { config } from "@/lib/config";
import { ProviderNarrativeSchema, type IntelligenceProvider } from "./types";

export const grokProvider: IntelligenceProvider = {
  id: "grok",
  label: "Grok",
  model: config.grokModel,
  capabilities: ["executive_reasoning", "fast_response", "long_context", "structured_output"],
  latency: "medium",
  cost: "medium",
  isConfigured: () => Boolean(config.xaiApiKey),
  async generate(request) {
    const client = new OpenAI({ apiKey: config.xaiApiKey, baseURL: "https://api.x.ai/v1" });
    const response = await client.chat.completions.create({
      model: config.grokModel,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "trajectory_narrative",
          strict: true,
          schema: z.toJSONSchema(ProviderNarrativeSchema),
        },
      },
    });
    const text = response.choices[0]?.message.content;
    if (!text) throw new Error("Grok returned no narrative");
    return {
      narrative: ProviderNarrativeSchema.parse(JSON.parse(text)),
      model: response.model,
    };
  },
};
