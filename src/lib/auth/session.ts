import "server-only";

import { cache } from "react";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("authentication required");
    this.name = "AuthenticationRequiredError";
  }
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
  provider: "auto" | "anthropic" | "openai" | "gemini" | "grok" | "local";
}

export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  if (!config.authEnabled) {
    return {
      id: config.ownerId,
      displayName: config.ownerName,
      provider: config.defaultProvider,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;
  if (error || !data || typeof subject !== "string") return null;
  const claims = data.claims;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, provider, last_active_at")
    .eq("id", subject)
    .maybeSingle();

  if (!profile?.last_active_at || Date.now() - new Date(profile.last_active_at).getTime() > 15 * 60_000) {
    await supabase.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", subject);
  }

  const email = typeof claims.email === "string" ? claims.email : undefined;
  return {
    id: subject,
    email,
    displayName:
      profile?.display_name ||
      (typeof claims.user_metadata === "object" && claims.user_metadata
        ? String((claims.user_metadata as Record<string, unknown>).full_name ?? "")
        : "") ||
      email?.split("@")[0] ||
      "there",
    avatarUrl: profile?.avatar_url ?? undefined,
    provider: (profile?.provider as AuthenticatedUser["provider"]) ?? "auto",
  };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationRequiredError();
  return user;
}
