import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { completeConnectorOAuth } from "@/lib/connectors/accounts";
import { isOAuthConnectorId } from "@/lib/connectors/oauth";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!isOAuthConnectorId(id) || !code || !state) {
    return NextResponse.redirect(`${config.appUrl}/dashboard?connector=failed`);
  }
  try {
    await completeConnectorOAuth(id, code, state);
    return NextResponse.redirect(`${config.appUrl}/dashboard?connector=connected`);
  } catch (error) {
    console.error("connector OAuth callback failed", error);
    return NextResponse.redirect(`${config.appUrl}/dashboard?connector=failed`);
  }
}
