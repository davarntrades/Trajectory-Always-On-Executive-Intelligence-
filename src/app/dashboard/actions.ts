"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { disconnectConnector } from "@/lib/connectors/accounts";
import { oauthConnectorIds } from "@/lib/connectors/oauth";

export async function disconnectConnectorAction(formData: FormData) {
  const connectorId = z.enum(oauthConnectorIds).parse(formData.get("connectorId"));
  await disconnectConnector(connectorId);
  revalidatePath("/dashboard");
  redirect("/dashboard?connector=disconnected");
}
