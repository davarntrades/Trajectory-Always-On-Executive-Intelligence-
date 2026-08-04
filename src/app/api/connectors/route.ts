import { NextResponse } from "next/server";
import { listConnectorAccounts } from "@/lib/connectors/accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ connectors: await listConnectorAccounts() });
}
