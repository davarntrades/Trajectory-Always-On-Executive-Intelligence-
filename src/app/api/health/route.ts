import { NextResponse } from "next/server";
import {
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
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
