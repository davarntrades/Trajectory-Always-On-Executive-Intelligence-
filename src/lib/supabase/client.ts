"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabasePublicConfig } from "./env";

export function createClient() {
  const { url, publishableKey } = requireSupabasePublicConfig();
  return createBrowserClient(url, publishableKey);
}
