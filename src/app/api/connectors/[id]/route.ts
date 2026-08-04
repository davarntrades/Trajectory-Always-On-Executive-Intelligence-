import { NextResponse } from "next/server";
import { disconnectConnector } from "@/lib/connectors/accounts";
import { updateConnectorPermissions } from "@/lib/connectors/accounts";
import { isOAuthConnectorId } from "@/lib/connectors/oauth";
import { z } from "zod";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isOAuthConnectorId(id)) return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  await disconnectConnector(id);
  return NextResponse.json({ disconnected: true });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isOAuthConnectorId(id)) return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  const { permissions } = z.object({ permissions: z.array(z.string()).max(30) }).parse(await request.json());
  await updateConnectorPermissions(id, permissions);
  return NextResponse.json({ updated: true });
}
