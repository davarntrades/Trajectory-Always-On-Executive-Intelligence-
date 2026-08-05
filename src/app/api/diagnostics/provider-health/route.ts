import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { providerOptions } from "@/lib/providers";
import { providerRuntimeDiagnostics } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const openai = providerOptions().find((option) => option.id === "openai");
  const runtime = providerRuntimeDiagnostics("openai");
  const result = {
    provider: "openai",
    configured: Boolean(openai?.configured),
    capabilityEligible: Boolean(openai?.capabilities.includes("executive_reasoning")),
    resolvedModel: openai?.model ?? runtime.resolvedModel,
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
