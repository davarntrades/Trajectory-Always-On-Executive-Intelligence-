import { z } from "zod";

export const providerIds = ["anthropic", "openai", "gemini", "grok", "local"] as const;
export const providerPreferences = [...providerIds, "auto"] as const;

export type ProviderId = (typeof providerIds)[number];
export type ProviderPreference = (typeof providerPreferences)[number];

export const ProviderNarrativeSchema = z.object({
  todaysObjective: z.string().trim().min(8).max(420),
  reasoning: z.string().trim().min(40).max(1200),
  recommendedAction: z.object({
    title: z.string().trim().min(8).max(420),
    why: z.string().trim().min(20).max(600),
  }),
  currentObservation: z.string().trim().min(12).max(320),
  currentConstraint: z.string().trim().min(8).max(240),
  expectedImpact: z.string().trim().min(12).max(320),
  confidence: z.number().min(0).max(1),
  suggestedNextAction: z.string().trim().min(6).max(180),
  urgency: z.number().min(0).max(1),
});

export type ProviderNarrative = z.infer<typeof ProviderNarrativeSchema>;

export interface ProviderRequest {
  systemPrompt: string;
  prompt: string;
}

export interface ProviderResponse {
  narrative: ProviderNarrative;
  model: string;
  requestId?: string | null;
}

export interface IntelligenceProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly latency: "low" | "medium" | "high";
  readonly cost: "low" | "medium" | "high";
  isConfigured(): boolean;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderOption {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
  capabilities: readonly ProviderCapability[];
}

export type ProviderCapability =
  | "executive_reasoning"
  | "fast_response"
  | "long_context"
  | "structured_output"
  | "local_private";

export class NoProviderConfiguredError extends Error {
  constructor() {
    super("No executive-reasoning provider is configured for this deployment");
    this.name = "NoProviderConfiguredError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly providerId: ProviderId) {
    super(`${providerId} is not configured`);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * Detail captured from a failed provider call. Without this the only thing
 * reaching the logs was an error name, which made a live failure impossible to
 * attribute to a status code, a rate limit, a refusal or a truncated response.
 */
export interface ProviderFailureDetail {
  /** HTTP status from the provider, when the failure reached it. */
  status?: number;
  /** Provider-side error discriminator, e.g. rate_limit_error. */
  providerErrorType?: string;
  /** Provider request identifier, for correlation with provider-side logs. */
  providerRequestId?: string | null;
  /** Seconds the provider asked us to wait, on a rate limit. */
  retryAfterSeconds?: number;
  /** Why the model stopped, when the call succeeded but the output was unusable. */
  stopReason?: string;
  /** Refusal category, when the provider declined the request. */
  refusalCategory?: string;
}

export class ProviderRequestError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly model: string,
    public readonly causeName: string,
    message: string,
    public readonly detail: ProviderFailureDetail = {},
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

/**
 * Reads status, error type, request id and retry-after off an SDK error
 * without assuming a particular provider's error class.
 */
export function describeProviderFailure(error: unknown): ProviderFailureDetail {
  if (!error || typeof error !== "object") return {};
  const candidate = error as {
    status?: unknown;
    type?: unknown;
    request_id?: unknown;
    requestID?: unknown;
    error?: { type?: unknown };
    headers?: unknown;
  };
  const detail: ProviderFailureDetail = {};
  if (typeof candidate.status === "number") detail.status = candidate.status;
  const providerErrorType = candidate.type ?? candidate.error?.type;
  if (typeof providerErrorType === "string") detail.providerErrorType = providerErrorType;
  const requestId = candidate.request_id ?? candidate.requestID;
  if (typeof requestId === "string") detail.providerRequestId = requestId;

  const headers = candidate.headers;
  const rawRetryAfter =
    headers instanceof Headers
      ? headers.get("retry-after")
      : headers && typeof headers === "object"
        ? (headers as Record<string, unknown>)["retry-after"]
        : undefined;
  const retryAfter = Number(rawRetryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) detail.retryAfterSeconds = retryAfter;

  return detail;
}
