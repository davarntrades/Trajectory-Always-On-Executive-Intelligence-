import { config } from "@/lib/config";

export function requireSupabasePublicConfig() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Supabase public configuration is incomplete");
  }
  return {
    url: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
  };
}
