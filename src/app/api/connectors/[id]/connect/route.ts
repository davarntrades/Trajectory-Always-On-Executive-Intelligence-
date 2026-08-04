import { NextResponse } from "next/server";
import { beginConnectorOAuth } from "@/lib/connectors/accounts";
import { isOAuthConnectorId } from "@/lib/connectors/oauth";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isOAuthConnectorId(id)) return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  return NextResponse.redirect(await beginConnectorOAuth(id));
}
