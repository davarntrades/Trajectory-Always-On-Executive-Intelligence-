import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { config, providerRuntimeDiagnostics } from "@/lib/config";
import { probeOpenAIProvider } from "@/lib/providers/openai";

export const dynamic = "force-dynamic";

interface SafeProviderFailure {
  ok: false;
  provider: "openai";
  model: string;
  requestAttempted: true;
  httpStatus: number | null;
  requestId: string | null;
  errorClass: string;
  errorCode: string | null;
  errorType: string | null;
  classification:
    | "authentication"
    | "model_access"
    | "invalid_model"
    | "quota_or_billing"
    | "rate_limit"
    | "request_schema"
    | "sdk_compatibility"
    | "provider_unavailable"
    | "unknown";
}

function classifyOpenAIError(error: unknown): SafeProviderFailure {
  const apiError = error instanceof OpenAI.APIError ? error : null;
  const status = apiError?.status ?? null;
  const code = typeof apiError?.code === "string" ? apiError.code : null;
  const type = typeof apiError?.type === "string" ? apiError.type : null;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  let classification: SafeProviderFailure["classification"] = "unknown";
  if (status === 401 || code === "invalid_api_key") classification = "authentication";
  else if (code === "model_not_found" || /model.*does not exist|invalid model/.test(message)) classification = "invalid_model";
  else if (status === 403 || /access.*model|not have access/.test(message)) classification = "model_access";
  else if (status === 429 && /quota|billing|credits/.test(message)) classification = "quota_or_billing";
  else if (status === 429) classification = "rate_limit";
  else if (status === 400 || code === "invalid_request_error") classification = "request_schema";
  else if (/parse|structured|schema|unsupported/.test(message)) classification = "sdk_compatibility";
  else if (status !== null && status >= 500) classification = "provider_unavailable";

  return {
    ok: false,
    provider: "openai",
    model: config.openaiModel,
    requestAttempted: true,
    httpStatus: status,
    requestId: apiError?.requestID ?? null,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    errorCode: code,
    errorType: type,
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

  const runtime = providerRuntimeDiagnostics("openai");
  if (!runtime.openaiKeyPresent) {
    return NextResponse.json(
      {
        ok: false,
        provider: "openai",
        model: runtime.resolvedModel,
        requestAttempted: false,
        httpStatus: null,
        requestId: null,
        errorClass: "NoProviderConfiguredError",
        errorCode: "no_provider_configured",
        errorType: null,
        classification: "authentication",
        vercelEnv: runtime.vercelEnv,
        deploymentCommit: runtime.gitCommitSha,
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const result = await probeOpenAIProvider();
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
    const failure = classifyOpenAIError(error);
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
