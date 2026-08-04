import "server-only";

import { config, hasSupabaseAdmin } from "@/lib/config";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredentials, encryptCredentials } from "./crypto";
import {
  buildAuthorizationUrl,
  connectorConfigured,
  createOAuthProof,
  exchangeAuthorizationCode,
  hashOAuthState,
  oauthConnectors,
  type OAuthConnectorId,
} from "./oauth";

export async function listConnectorAccounts() {
  const user = await requireUser();
  if (!hasSupabaseAdmin()) {
    return Object.values(oauthConnectors).map((spec) => ({
      id: spec.id,
      name: spec.name,
      configured: false,
      connection: { connector_id: spec.id, status: "disconnected", permissions: [], oauth_scopes: spec.scopes, sync_status: "idle" },
    }));
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("connector_accounts")
    .select("connector_id, display_name, status, permissions, oauth_scopes, sync_status, last_sync_at, last_health_at, token_expires_at, last_error")
    .eq("owner_id", user.id);
  if (error) throw new Error(`connector accounts: ${error.message}`);
  const accounts = new Map((data ?? []).map((row) => [row.connector_id, row]));
  return Object.values(oauthConnectors).map((spec) => ({
    id: spec.id,
    name: spec.name,
    configured: connectorConfigured(spec),
    connection: accounts.get(spec.id) ?? {
      connector_id: spec.id,
      status: "disconnected",
      permissions: [],
      oauth_scopes: spec.scopes,
      sync_status: "idle",
    },
  }));
}

export async function beginConnectorOAuth(connectorId: OAuthConnectorId) {
  const user = await requireUser();
  const spec = oauthConnectors[connectorId];
  if (!connectorConfigured(spec)) throw new Error(`${spec.name} OAuth is not configured`);
  const proof = createOAuthProof();
  const redirectUri = `${config.appUrl}/api/connectors/${connectorId}/callback`;
  const admin = createAdminClient();
  const { error } = await admin.from("oauth_states").insert({
    user_id: user.id,
    connector_id: connectorId,
    state_hash: proof.stateHash,
    code_verifier: spec.pkce ? proof.verifier : null,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new Error(`OAuth state: ${error.message}`);
  return buildAuthorizationUrl(spec, { state: proof.state, challenge: proof.challenge, redirectUri });
}

export async function completeConnectorOAuth(connectorId: OAuthConnectorId, code: string, state: string) {
  const user = await requireUser();
  const admin = createAdminClient();
  const stateHash = hashOAuthState(state);
  const { data: record, error } = await admin
    .from("oauth_states")
    .select("id, code_verifier, redirect_uri, expires_at, consumed_at")
    .eq("user_id", user.id)
    .eq("connector_id", connectorId)
    .eq("state_hash", stateHash)
    .maybeSingle();
  if (error || !record || record.consumed_at || new Date(record.expires_at).getTime() <= Date.now()) {
    throw new Error("OAuth state is invalid or expired");
  }
  const spec = oauthConnectors[connectorId];
  const tokens = await exchangeAuthorizationCode(spec, {
    code,
    verifier: record.code_verifier ?? undefined,
    redirectUri: record.redirect_uri,
  });
  const encrypted = encryptCredentials(tokens);
  const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : undefined;
  const now = new Date().toISOString();
  const { error: accountError } = await admin.from("connector_accounts").upsert({
    owner_id: user.id,
    connector_id: connectorId,
    display_name: spec.name,
    status: "connected",
    credentials: null,
    encrypted_credentials: encrypted.encryptedCredentials,
    credential_iv: encrypted.credentialIv,
    credential_tag: encrypted.credentialTag,
    permissions: spec.scopes,
    oauth_scopes: spec.scopes,
    sync_status: "idle",
    last_health_at: now,
    token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    last_error: null,
    updated_at: now,
  }, { onConflict: "owner_id,connector_id" });
  if (accountError) throw new Error(`connector account: ${accountError.message}`);
  await admin.from("oauth_states").update({ consumed_at: now }).eq("id", record.id).eq("user_id", user.id);
}

export async function disconnectConnector(connectorId: OAuthConnectorId) {
  const user = await requireUser();
  const admin = createAdminClient();
  const { error } = await admin.from("connector_accounts").update({
    status: "disconnected",
    encrypted_credentials: null,
    credential_iv: null,
    credential_tag: null,
    token_expires_at: null,
    sync_cursor: null,
    updated_at: new Date().toISOString(),
  }).eq("owner_id", user.id).eq("connector_id", connectorId);
  if (error) throw new Error(`disconnect connector: ${error.message}`);
}

export async function syncConnector(connectorId: OAuthConnectorId) {
  const user = await requireUser();
  const admin = createAdminClient();
  const { data: account, error } = await admin.from("connector_accounts")
    .select("id, status, encrypted_credentials, credential_iv, credential_tag, token_expires_at")
    .eq("owner_id", user.id).eq("connector_id", connectorId).maybeSingle();
  if (error || !account || account.status !== "connected") throw new Error("connector is not connected");
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await admin.from("connector_sync_runs").insert({
    user_id: user.id, connector_account_id: account.id, status: "running", started_at: startedAt,
  }).select("id").single();
  if (runError || !run) throw new Error(`connector sync: ${runError?.message ?? "missing run"}`);
  try {
    if (!account.encrypted_credentials || !account.credential_iv || !account.credential_tag) throw new Error("connector credentials are unavailable");
    decryptCredentials({ encryptedCredentials: account.encrypted_credentials, credentialIv: account.credential_iv, credentialTag: account.credential_tag });
    if (account.token_expires_at && new Date(account.token_expires_at).getTime() <= Date.now()) throw new Error("connector access token requires refresh");
    const completedAt = new Date().toISOString();
    await Promise.all([
      admin.from("connector_sync_runs").update({ status: "succeeded", events_observed: 0, events_added: 0, completed_at: completedAt }).eq("id", run.id).eq("user_id", user.id),
      admin.from("connector_accounts").update({ sync_status: "idle", last_sync_at: completedAt, last_health_at: completedAt, last_error: null, updated_at: completedAt }).eq("id", account.id).eq("owner_id", user.id),
    ]);
    return { status: "healthy", eventsObserved: 0, eventsAdded: 0, lastSyncAt: completedAt };
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "sync failed";
    await Promise.all([
      admin.from("connector_sync_runs").update({ status: "failed", error: message, completed_at: new Date().toISOString() }).eq("id", run.id).eq("user_id", user.id),
      admin.from("connector_accounts").update({ status: "degraded", sync_status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("id", account.id).eq("owner_id", user.id),
    ]);
    throw syncError;
  }
}

export async function updateConnectorPermissions(connectorId: OAuthConnectorId, permissions: string[]) {
  const user = await requireUser();
  const allowed = new Set(oauthConnectors[connectorId].scopes);
  if (permissions.some((permission) => !allowed.has(permission))) throw new Error("unsupported connector permission");
  const admin = createAdminClient();
  const { error } = await admin.from("connector_accounts")
    .update({ permissions: [...new Set(permissions)], updated_at: new Date().toISOString() })
    .eq("owner_id", user.id).eq("connector_id", connectorId);
  if (error) throw new Error(`connector permissions: ${error.message}`);
}
