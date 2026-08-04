import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const oauthConnectorIds = [
  "google-calendar",
  "gmail",
  "outlook",
  "notion",
  "github",
  "slack",
] as const;

export type OAuthConnectorId = (typeof oauthConnectorIds)[number];

export interface OAuthConnectorSpec {
  id: OAuthConnectorId;
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: readonly string[];
  pkce: boolean;
  authorizationParams?: Record<string, string>;
}

const googleBase = {
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  pkce: true,
  authorizationParams: { access_type: "offline", prompt: "consent" },
} as const;

export const oauthConnectors: Record<OAuthConnectorId, OAuthConnectorSpec> = {
  "google-calendar": {
    ...googleBase,
    id: "google-calendar",
    name: "Google Calendar",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
  },
  gmail: {
    ...googleBase,
    id: "gmail",
    name: "Gmail",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
  },
  outlook: {
    id: "outlook",
    name: "Outlook",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    scopes: ["openid", "email", "offline_access", "Mail.Read", "Calendars.Read"],
    pkce: true,
  },
  notion: {
    id: "notion",
    name: "Notion",
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    scopes: [],
    pkce: false,
    authorizationParams: { owner: "user" },
  },
  github: {
    id: "github",
    name: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    scopes: ["read:user", "user:email", "repo"],
    pkce: false,
  },
  slack: {
    id: "slack",
    name: "Slack",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    scopes: ["channels:history", "channels:read", "users:read"],
    pkce: false,
  },
};

export function isOAuthConnectorId(value: string): value is OAuthConnectorId {
  return oauthConnectorIds.includes(value as OAuthConnectorId);
}

export function connectorConfigured(spec: OAuthConnectorSpec) {
  return Boolean(process.env[spec.clientIdEnv] && process.env[spec.clientSecretEnv]);
}

export function createOAuthProof() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, stateHash: hashOAuthState(state), verifier, challenge };
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function buildAuthorizationUrl(spec: OAuthConnectorSpec, input: { state: string; challenge: string; redirectUri: string }) {
  const url = new URL(spec.authorizationUrl);
  url.searchParams.set("client_id", process.env[spec.clientIdEnv] ?? "");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (spec.scopes.length) url.searchParams.set(spec.id === "slack" ? "user_scope" : "scope", spec.scopes.join(" "));
  if (spec.pkce) {
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(spec.authorizationParams ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

export async function exchangeAuthorizationCode(spec: OAuthConnectorSpec, input: { code: string; verifier?: string; redirectUri: string }) {
  const clientId = process.env[spec.clientIdEnv] ?? "";
  const clientSecret = process.env[spec.clientSecretEnv] ?? "";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (spec.id === "notion") {
    body.delete("client_id");
    body.delete("client_secret");
  }
  if (spec.pkce && input.verifier) body.set("code_verifier", input.verifier);
  const response = await fetch(spec.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      ...(spec.id === "notion" ? { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {}),
    },
    body,
    cache: "no-store",
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.error) {
    throw new Error(`OAuth token exchange failed for ${spec.id}`);
  }
  return payload;
}
