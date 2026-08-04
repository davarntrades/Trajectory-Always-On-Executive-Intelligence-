import { NextResponse } from "next/server";
import { alreadyKnows, retrieveMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";

/**
 * Memory retrieval.
 *
 * `?check=1` runs the never-ask-twice check instead of a plain retrieval: it
 * answers "do I already know this?" so Trajectory never asks for information it
 * holds.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });

  if (url.searchParams.get("check") === "1") {
    const known = await alreadyKnows(q);
    return NextResponse.json({ known: Boolean(known), memory: known });
  }

  const limit = Number(url.searchParams.get("limit") ?? 10);
  return NextResponse.json({ memories: await retrieveMemory(q, { limit }) });
}
