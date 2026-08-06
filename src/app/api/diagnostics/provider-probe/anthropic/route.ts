import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { config, providerRuntimeDiagnostics } from "@/lib/config";
import { probeAnthropicProvider } from "@/lib/providers/anthropic";

export const dynamic = "force-dynamic";

type FailureClassification =
  | "authentication"
  | "model_access"
  | "invalid_model"
  | "quota_or_billing"
  | "rate_limit"
  | "request_schema"
  | "sdk_compatibility"
  | "provider_unavailable"
  | "unknown";

function errorRecord(error: unknown): Record<string, unknown> {
  return typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
}

function classify(error: unknown) {
  const record = errorRecord(error);
  const status = typeof record.status === "number" ? record.status : null;
  const code = typeof record.code === "string" ? record.code : null;
  const type = typeof record.type === "string" ? record.type : null;
  const requestId = typeof record.request_id === "string"
    ? record.request_id
    : typeof record.requestID === "string"
      ? record.requestID
      : null;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  let classification: FailureClassification = "unknown";
  if (status === 401 || /api key|authentication|unauthorized/.test(message)) classification = "authentication";
  else if (status === 403 || /permission|access.*model|not allowed/.test(message)) classification = "model_access";
  else if (/model.*not found|invalid model|unknown model/.test(message)) classification = "invalid_model";
  else if (status === 429 && /credit|billing|quota/.test(message)) classification = "quota_or_billing";
  else if (status === 429) classification = "rate_limit";
  else if (status === 400 || /schema|invalid request|output_config|thinking/.test(message)) classification = "request_schema";
  else if (/parse|json|structured/.test(message)) classification = "sdk_compatibility";
  else if (status !== null && status >= 500) classification = "provider_unavailable";

  return {
    ok: false as const,
    provider: "anthropic" as const,
    model: config.anthropicModel,
    requestAttempted: true as const,
    httpStatus: status,
    requestId,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    errorCode: code,
    errorType: type,
    structuredValidationPassed: false as const,
    classification,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "authentication_required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const runtime = providerRuntimeDiagnostics("anthropic");
  if (!config.anthropicApiKey) {
    return NextResponse.json(
      {
        ok: false,
        provider: "anthropic",
        model: config.anthropicModel,
        requestAttempted: false,
        httpStatus: null,
        requestId: null,
        errorClass: "NoProviderConfiguredError",
        errorCode: "no_provider_configured",
        errorType: null,
        structuredValidationPassed: false,
        classification: "authentication",
        vercelEnv: runtime.vercelEnv,
        deploymentCommit: runtime.gitCommitSha,
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const result = await probeAnthropicProvider();
    const body = {
      ...result,
      vercelEnv: runtime.vercelEnv,
      deploymentCommit: runtime.gitCommitSha,
    };
    console.info("[trajectory:provider-probe]", { userId: user.id, ...body });
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const failure = classify(error);
    const body = {
      ...failure,
      vercelEnv: runtime.vercelEnv,
      deploymentCommit: runtime.gitCommitSha,
    };
    console.error("[trajectory:provider-probe]", { userId: user.id, ...body });
    return NextResponse.json(body, {
      status: failure.httpStatus && failure.httpStatus >= 400 ? failure.httpStatus : 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
