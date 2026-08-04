import OpenAI from "openai";
import { config } from "@/lib/config";
import { ProviderNarrativeSchema, type IntelligenceProvider } from "./types";

function localBaseUrl() {
  const base = config.localProviderBaseUrl;
  if (!base) throw new Error("Local provider URL is not configured");
  return base.endsWith("/v1") || base.endsWith("/v1/")
    ? base.replace(/\/$/, "")
    : `${base.replace(/\/$/, "")}/v1`;
}

export const localProvider: IntelligenceProvider = {
  id: "local",
  label: "Local",
  model: config.localModel,
  capabilities: ["executive_reasoning", "structured_output", "local_private"],
  latency: "low",
  cost: "low",
  isConfigured: () => Boolean(config.localProviderBaseUrl),
  async generate(request) {
    // The endpoint is controlled only by server environment configuration,
    // never by browser input, preventing this adapter becoming an SSRF proxy.
    const client = new OpenAI({
      apiKey: config.localProviderApiKey ?? "trajectory-local",
      baseURL: localBaseUrl(),
    });
    const response = await client.chat.completions.create({
      model: config.localModel,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: `${request.prompt}\nReturn only valid JSON.` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    const text = response.choices[0]?.message.content;
    if (!text) throw new Error("Local provider returned no narrative");
    return {
      narrative: ProviderNarrativeSchema.parse(JSON.parse(text)),
      model: response.model,
    };
  },
};
