import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

/**
 * Service-role client for cron and encrypted connector credentials only.
 * Callers must always supply and filter by an already-authorised user id.
 */
export function createAdminClient() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error("Supabase admin configuration is incomplete");
  }
  return createSupabaseClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
