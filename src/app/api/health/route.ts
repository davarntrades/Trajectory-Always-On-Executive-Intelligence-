import { NextResponse } from "next/server";
import {
  productionEnvironmentStatus,
  runtimeMode,
} from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const environment = productionEnvironmentStatus();

  return NextResponse.json(
    {
      status: "ok",
      productionReady: environment.ready,
      mode: runtimeMode(),
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
