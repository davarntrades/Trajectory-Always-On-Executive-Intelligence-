import { NextResponse } from "next/server";
import {
  githubIngestionDiagnostics,
  productionEnvironmentStatus,
  runtimeMode,
} from "@/lib/config";
import { providerOptions } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const environment = productionEnvironmentStatus();

  return NextResponse.json(
    {
      status: "ok",
      productionReady: environment.ready,
      mode: runtimeMode(),
      providers: providerOptions(),
      missingEnvironmentVariables: environment.missing,
      // Presence and shape only, never values. This is what makes "the runtime
      // cannot see the variable" a fact rather than an inference.
      githubIngestion: githubIngestionDiagnostics(),
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
