import { NextResponse } from "next/server";
import { config, hasSupabaseAdmin } from "@/lib/config";
import { runBackgroundIntelligence } from "@/lib/background/intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasSupabaseAdmin()) return NextResponse.json({ error: "Supabase admin is unavailable" }, { status: 503 });
  return NextResponse.json(await runBackgroundIntelligence());
}
