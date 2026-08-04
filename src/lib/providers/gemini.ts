import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "@/lib/config";
import { ProviderNarrativeSchema, type IntelligenceProvider } from "./types";

export const geminiProvider: IntelligenceProvider = {
  id: "gemini",
  label: "Gemini",
  model: config.geminiModel,
  capabilities: ["executive_reasoning", "fast_response", "long_context", "structured_output"],
  latency: "low",
  cost: "low",
  isConfigured: () => Boolean(config.geminiApiKey),
  async generate(request) {
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const response = await client.models.generateContent({
      model: config.geminiModel,
      contents: request.prompt,
      config: {
        systemInstruction: request.systemPrompt,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(ProviderNarrativeSchema),
        temperature: 0.2,
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no narrative");
    return {
      narrative: ProviderNarrativeSchema.parse(JSON.parse(text)),
      model: config.geminiModel,
    };
  },
};
