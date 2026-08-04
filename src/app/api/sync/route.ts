import { NextResponse } from "next/server";
import { allConnectors } from "@/lib/connectors";
import { runSync } from "@/lib/workers/sync";
import { config } from "@/lib/config";
import { listConnectorAccounts } from "@/lib/connectors/accounts";

export const dynamic = "force-dynamic";

/** Connector status. */
export async function GET() {
  if (config.authEnabled) return NextResponse.json({ connectors: await listConnectorAccounts() });
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
  if (config.authEnabled) {
    return NextResponse.json(
      { error: "Use the per-user /api/connectors/:id/sync endpoint." },
      { status: 410 },
    );
  }
  try {
    return NextResponse.json(await runSync());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}
