/**
 * Runtime configuration.
 *
 * Trajectory is designed to run in three modes without code changes:
 *
 *   1. No credentials      → seeded local store, deterministic engine only.
 *   2. Provider API key    → engine + provider narrative reasoning.
 *   3. + Supabase          → persistent memory, real event log, audit trail.
 *
 * This is deliberate: the state engine is the part worth verifying, and it must
 * be verifiable before any OAuth flow exists.
 */

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

  /** Single-operator build. Multi-tenant arrives with real auth in Phase 2. */
  ownerId: process.env.TRAJECTORY_OWNER_ID ?? "00000000-0000-0000-0000-000000000001",
  ownerName: process.env.TRAJECTORY_OWNER_NAME ?? "Davarn",
  timezone: process.env.TRAJECTORY_TIMEZONE ?? "Europe/London",

  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.1",
  defaultProvider:
    process.env.TRAJECTORY_DEFAULT_PROVIDER === "openai" ||
    process.env.TRAJECTORY_DEFAULT_PROVIDER === "anthropic"
      ? process.env.TRAJECTORY_DEFAULT_PROVIDER
      : "auto",
} as const;

export const hasClaude = () => Boolean(config.anthropicApiKey);
export const hasOpenAI = () => Boolean(config.openaiApiKey);

export const hasSupabase = () =>
  Boolean(config.supabaseUrl && config.supabaseServiceKey);

const requiredProductionVariables = [
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** Safe, value-free diagnostics for deployment verification. */
export function productionEnvironmentStatus() {
  const missing = requiredProductionVariables.filter((name) => !process.env[name]);

  return {
    ready: missing.length === 0,
    missing,
  };
}

/** Which mode the app is actually running in — surfaced in the UI. */
export function runtimeMode(): {
  store: "supabase" | "seed";
  reasoning: "anthropic" | "openai" | "deterministic";
} {
  return {
    store: hasSupabase() ? "supabase" : "seed",
    reasoning: hasClaude() ? "anthropic" : hasOpenAI() ? "openai" : "deterministic",
  };
}
