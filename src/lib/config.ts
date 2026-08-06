/** Runtime configuration and value-free deployment diagnostics. */

const cleanSecret = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
};
const cleanValue = (value: string | undefined) => value?.trim() || undefined;

const supabaseUrl = cleanValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabasePublishableKey = cleanSecret(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const supabaseServiceKey = cleanSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
const hasCompleteSupabaseConfiguration = Boolean(supabaseUrl && supabasePublishableKey && supabaseServiceKey);

export const config = {
  anthropicApiKey: cleanSecret(process.env.ANTHROPIC_API_KEY),
  openaiApiKey: cleanSecret(process.env.OPENAI_API_KEY),
  geminiApiKey: cleanSecret(process.env.GEMINI_API_KEY),
  xaiApiKey: cleanSecret(process.env.XAI_API_KEY),
  localProviderBaseUrl: cleanValue(process.env.LOCAL_PROVIDER_BASE_URL),
  localProviderApiKey: cleanSecret(process.env.LOCAL_PROVIDER_API_KEY),
  supabaseUrl,
  supabasePublishableKey,
  supabaseServiceKey,
  authEnabled: process.env.TRAJECTORY_AUTH_ENABLED !== "false" && hasCompleteSupabaseConfiguration,
  appUrl: cleanValue(process.env.NEXT_PUBLIC_APP_URL) ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  connectorEncryptionKey: cleanSecret(process.env.CONNECTOR_ENCRYPTION_KEY),
  cronSecret: cleanSecret(process.env.CRON_SECRET),
  // Open-work ingestion. Read-only repository scope is sufficient; nothing in
  // this path writes to GitHub.
  githubToken: cleanSecret(process.env.GITHUB_INGESTION_TOKEN),
  githubRepository: cleanValue(process.env.GITHUB_INGESTION_REPOSITORY),
  ownerId: cleanValue(process.env.TRAJECTORY_OWNER_ID) ?? "00000000-0000-0000-0000-000000000001",
  ownerName: cleanValue(process.env.TRAJECTORY_OWNER_NAME) ?? "Davarn",
  timezone: cleanValue(process.env.TRAJECTORY_TIMEZONE) ?? "Europe/London",
  anthropicModel: cleanValue(process.env.ANTHROPIC_MODEL) ?? "claude-opus-5",
  openaiModel: cleanValue(process.env.OPENAI_MODEL) ?? "gpt-5.1",
  geminiModel: cleanValue(process.env.GEMINI_MODEL) ?? "gemini-3.5-flash",
  grokModel: cleanValue(process.env.GROK_MODEL) ?? "grok-4.20-non-reasoning-latest",
  localModel: cleanValue(process.env.LOCAL_PROVIDER_MODEL) ?? "gpt-oss:20b",
  defaultProvider: ["anthropic", "openai", "gemini", "grok", "local"].includes(cleanValue(process.env.TRAJECTORY_DEFAULT_PROVIDER) ?? "")
    ? cleanValue(process.env.TRAJECTORY_DEFAULT_PROVIDER) as "anthropic" | "openai" | "gemini" | "grok" | "local"
    : "auto",
} as const;

export const hasClaude = () => Boolean(config.anthropicApiKey);
export const hasOpenAI = () => Boolean(config.openaiApiKey);
export const hasGemini = () => Boolean(config.geminiApiKey);
export const hasGrok = () => Boolean(config.xaiApiKey);
export const hasLocalProvider = () => Boolean(config.localProviderBaseUrl);
export const hasSupabase = () => Boolean(config.supabaseUrl && config.supabasePublishableKey);
export const hasSupabaseAdmin = () => Boolean(config.supabaseUrl && config.supabaseServiceKey);

const requiredProductionVariables = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
export function productionEnvironmentStatus() {
  const missing: string[] = requiredProductionVariables.filter((name) => name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ? !config.supabasePublishableKey : !process.env[name]);
  if (!hasClaude() && !hasOpenAI() && !hasGemini() && !hasGrok() && !hasLocalProvider()) missing.push("ONE_PROVIDER_API_KEY");
  if (config.authEnabled) {
    if (!config.connectorEncryptionKey) missing.push("CONNECTOR_ENCRYPTION_KEY");
    if (!config.cronSecret) missing.push("CRON_SECRET");
    if (config.appUrl === "http://localhost:3000") missing.push("NEXT_PUBLIC_APP_URL");
  }
  return { ready: missing.length === 0, missing };
}

export function providerRuntimeDiagnostics(requestedProvider: string) {
  const rawOpenAIKey = process.env.OPENAI_API_KEY;
  const trimmedOpenAIKey = rawOpenAIKey?.trim() ?? "";
  const unquotedOpenAIKey = cleanSecret(rawOpenAIKey) ?? "";
  const normalizedProvider = requestedProvider.trim().toLowerCase().replace(/[_\s-]+/g, "");
  return {
    environment: process.env.NODE_ENV ?? "unknown",
    vercelEnv: process.env.VERCEL_ENV ?? "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? "unknown",
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    requestedProvider,
    normalizedProvider,
    openaiKeyPresent: Boolean(unquotedOpenAIKey),
    openaiKeyTrimmedLength: unquotedOpenAIKey.length,
    openaiKeyHasExpectedPrefix: /^(sk-proj-|sk-)/.test(unquotedOpenAIKey),
    openaiKeyHadWhitespace: Boolean(rawOpenAIKey && rawOpenAIKey !== trimmedOpenAIKey),
    openaiKeyHadWrappingQuotes: Boolean(trimmedOpenAIKey && unquotedOpenAIKey !== trimmedOpenAIKey),
    openaiModelPresent: Boolean(cleanValue(process.env.OPENAI_MODEL)),
    resolvedModel: config.openaiModel,
    providerCapabilityEligible: true,
  };
}

export function runtimeMode(): { store: "supabase" | "seed"; reasoning: "anthropic" | "openai" | "gemini" | "grok" | "local" | "deterministic"; auth: "enabled" | "disabled" } {
  return {
    store: hasSupabase() ? "supabase" : "seed",
    reasoning: hasClaude() ? "anthropic" : hasOpenAI() ? "openai" : hasGemini() ? "gemini" : hasGrok() ? "grok" : hasLocalProvider() ? "local" : "deterministic",
    auth: config.authEnabled ? "enabled" : "disabled",
  };
}
