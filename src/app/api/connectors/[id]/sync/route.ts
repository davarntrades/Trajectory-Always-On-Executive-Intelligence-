import { NextResponse } from "next/server";
import { syncConnector } from "@/lib/connectors/accounts";
import { isOAuthConnectorId } from "@/lib/connectors/oauth";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isOAuthConnectorId(id)) return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  return NextResponse.json(await syncConnector(id));
}
