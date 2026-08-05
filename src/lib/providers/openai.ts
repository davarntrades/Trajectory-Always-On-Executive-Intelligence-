import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "@/lib/config";
import {
  ProviderNarrativeSchema,
  type IntelligenceProvider,
  type ProviderRequest,
} from "./types";

function createClient() {
  return new OpenAI({ apiKey: config.openaiApiKey });
}

async function requestStructuredNarrative(request: ProviderRequest) {
  return createClient().responses.parse({
    model: config.openaiModel,
    instructions: request.systemPrompt,
    input: request.prompt,
    text: {
      format: zodTextFormat(ProviderNarrativeSchema, "trajectory_narrative"),
    },
  });
}

export const openAIProvider: IntelligenceProvider = {
  id: "openai",
  label: "OpenAI",
  model: config.openaiModel,
  capabilities: ["executive_reasoning", "fast_response", "structured_output"],
  latency: "medium",
  cost: "medium",
  isConfigured: () => Boolean(config.openaiApiKey),
  async generate(request: ProviderRequest) {
    const response = await requestStructuredNarrative(request);

    if (!response.output_parsed) {
      throw new Error("OpenAI returned no structured narrative");
    }

    return {
      narrative: response.output_parsed,
      model: response.model,
    };
  },
};

export interface OpenAIProbeSuccess {
  ok: true;
  provider: "openai";
  model: string;
  requestAttempted: true;
  httpStatus: 200;
  requestId: string | null;
  structuredOutputParsed: true;
}

export async function probeOpenAIProvider(): Promise<OpenAIProbeSuccess> {
  const response = await requestStructuredNarrative({
    systemPrompt: "Return the required structured object. Keep every field concise.",
    prompt: "Set the objective and action to verify this provider connection. Explain that the request proves structured output is available.",
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI returned no structured narrative during provider probe");
  }

  return {
    ok: true,
    provider: "openai",
    model: response.model,
    requestAttempted: true,
    httpStatus: 200,
    requestId: response._request_id ?? null,
    structuredOutputParsed: true,
  };
}
