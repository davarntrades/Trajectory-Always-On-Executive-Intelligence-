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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCompleteSupabaseConfiguration = Boolean(
  supabaseUrl && supabasePublishableKey && supabaseServiceKey,
);

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  xaiApiKey: process.env.XAI_API_KEY,
  localProviderBaseUrl: process.env.LOCAL_PROVIDER_BASE_URL,
  localProviderApiKey: process.env.LOCAL_PROVIDER_API_KEY,
  supabaseUrl,
  supabasePublishableKey,
  supabaseServiceKey,
  // A complete Supabase environment now activates the production workspace by
  // default. An explicit false remains available as an incident kill switch.
  authEnabled:
    process.env.TRAJECTORY_AUTH_ENABLED !== "false" &&
    hasCompleteSupabaseConfiguration,
  appUrl:
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"),
  connectorEncryptionKey: process.env.CONNECTOR_ENCRYPTION_KEY,
  cronSecret: process.env.CRON_SECRET,

  /** Single-operator build. Multi-tenant arrives with real auth in Phase 2. */
  ownerId: process.env.TRAJECTORY_OWNER_ID ?? "00000000-0000-0000-0000-000000000001",
  ownerName: process.env.TRAJECTORY_OWNER_NAME ?? "Davarn",
  timezone: process.env.TRAJECTORY_TIMEZONE ?? "Europe/London",

  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.1",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  grokModel: process.env.GROK_MODEL ?? "grok-4.20-non-reasoning-latest",
  localModel: process.env.LOCAL_PROVIDER_MODEL ?? "gpt-oss:20b",
  defaultProvider: ["anthropic", "openai", "gemini", "grok", "local"].includes(
    process.env.TRAJECTORY_DEFAULT_PROVIDER ?? "",
  )
    ? process.env.TRAJECTORY_DEFAULT_PROVIDER as
        | "anthropic"
        | "openai"
        | "gemini"
        | "grok"
        | "local"
    : "auto",
} as const;

export const hasClaude = () => Boolean(config.anthropicApiKey);
export const hasOpenAI = () => Boolean(config.openaiApiKey);
export const hasGemini = () => Boolean(config.geminiApiKey);
export const hasGrok = () => Boolean(config.xaiApiKey);
export const hasLocalProvider = () => Boolean(config.localProviderBaseUrl);

export const hasSupabase = () =>
  Boolean(config.supabaseUrl && config.supabasePublishableKey);

export const hasSupabaseAdmin = () =>
  Boolean(config.supabaseUrl && config.supabaseServiceKey);

const requiredProductionVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** Safe, value-free diagnostics for deployment verification. */
export function productionEnvironmentStatus() {
  const missing: string[] = requiredProductionVariables.filter((name) => {
    if (name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") {
      return !config.supabasePublishableKey;
    }
    return !process.env[name];
  });

  if (!hasClaude() && !hasOpenAI() && !hasGemini() && !hasGrok() && !hasLocalProvider()) {
    missing.push("ONE_PROVIDER_API_KEY");
  }

  if (config.authEnabled) {
    if (!config.connectorEncryptionKey) missing.push("CONNECTOR_ENCRYPTION_KEY");
    if (!config.cronSecret) missing.push("CRON_SECRET");
    if (config.appUrl === "http://localhost:3000") missing.push("NEXT_PUBLIC_APP_URL");
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

/** Which mode the app is actually running in — surfaced in the UI. */
export function runtimeMode(): {
  store: "supabase" | "seed";
  reasoning: "anthropic" | "openai" | "gemini" | "grok" | "local" | "deterministic";
  auth: "enabled" | "disabled";
} {
  return {
    store: hasSupabase() ? "supabase" : "seed",
    reasoning: hasClaude()
      ? "anthropic"
      : hasOpenAI()
        ? "openai"
        : hasGemini()
          ? "gemini"
          : hasGrok()
            ? "grok"
            : hasLocalProvider()
              ? "local"
              : "deterministic",
    auth: config.authEnabled ? "enabled" : "disabled",
  };
}
