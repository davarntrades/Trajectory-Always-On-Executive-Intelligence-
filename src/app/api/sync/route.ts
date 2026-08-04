import { NextResponse } from "next/server";
import { allConnectors } from "@/lib/connectors";
import { runSync } from "@/lib/workers/sync";

export const dynamic = "force-dynamic";

/** Connector status. */
export async function GET() {
  return NextResponse.json({
    connectors: allConnectors().map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      configured: c.isConfigured(),
      capabilities: c.capabilities,
    })),
  });
}

/** Run a sync pass across all configured connectors, then recompute state. */
export async function POST() {
  try {
    return NextResponse.json(await runSync());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}
