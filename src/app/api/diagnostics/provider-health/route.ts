import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { config, providerRuntimeDiagnostics } from "@/lib/config";
import { providerOptions } from "@/lib/providers";

export const dynamic = "force-dynamic";

function cleanSecret(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const requested = request.nextUrl.searchParams.get("provider")?.trim().toLowerCase() ?? "openai";
  const provider = requested === "anthropic" ? "anthropic" : "openai";
  const option = providerOptions().find((candidate) => candidate.id === provider);
  const runtime = providerRuntimeDiagnostics(provider);

  if (provider === "anthropic") {
    const rawKey = process.env.ANTHROPIC_API_KEY;
    const trimmed = rawKey?.trim() ?? "";
    const cleaned = cleanSecret(rawKey);
    const result = {
      provider,
      configured: Boolean(option?.configured),
      capabilityEligible: Boolean(option?.capabilities.includes("executive_reasoning")),
      resolvedModel: option?.model ?? config.anthropicModel,
      runtimeEnvironment: runtime.environment,
      vercelEnv: runtime.vercelEnv,
      deploymentId: runtime.deploymentId,
      deploymentCommit: runtime.gitCommitSha,
      anthropicKeyPresent: Boolean(cleaned),
      anthropicKeyTrimmedLength: cleaned.length,
      anthropicKeyHadWhitespace: Boolean(rawKey && rawKey !== trimmed),
      anthropicKeyHadWrappingQuotes: Boolean(trimmed && cleaned !== trimmed),
      anthropicModelOverridePresent: Boolean(process.env.ANTHROPIC_MODEL?.trim()),
    };
    console.info("[trajectory:provider-health]", { userId: user.id, ...result });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }

  const result = {
    provider,
    configured: Boolean(option?.configured),
    capabilityEligible: Boolean(option?.capabilities.includes("executive_reasoning")),
    resolvedModel: option?.model ?? runtime.resolvedModel,
    runtimeEnvironment: runtime.environment,
    vercelEnv: runtime.vercelEnv,
    deploymentId: runtime.deploymentId,
    deploymentCommit: runtime.gitCommitSha,
    openaiKeyPresent: runtime.openaiKeyPresent,
    openaiKeyTrimmedLength: runtime.openaiKeyTrimmedLength,
    openaiKeyHasExpectedPrefix: runtime.openaiKeyHasExpectedPrefix,
    openaiKeyHadWhitespace: runtime.openaiKeyHadWhitespace,
    openaiKeyHadWrappingQuotes: runtime.openaiKeyHadWrappingQuotes,
    openaiModelOverridePresent: runtime.openaiModelPresent,
  };

  console.info("[trajectory:provider-health]", { userId: user.id, ...result });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
