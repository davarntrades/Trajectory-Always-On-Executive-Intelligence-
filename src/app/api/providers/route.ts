import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { providerOptions } from "@/lib/providers";

export const dynamic = "force-dynamic";

/** Safe provider metadata only. Credentials never cross the server boundary. */
export async function GET() {
  return NextResponse.json(
    {
      defaultProvider: config.defaultProvider,
      providers: providerOptions(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
