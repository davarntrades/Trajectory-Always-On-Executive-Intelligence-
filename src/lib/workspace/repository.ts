import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase, hasSupabaseAdmin } from "@/lib/config";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ProviderId, ProviderPreference } from "@/lib/providers/types";
import type { Goal, TrajectoryState } from "@/lib/types";

export interface ConversationRecord {
  id: string;
  title: string;
  status: "active" | "archived";
  provider?: ProviderId;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  provider?: string;
  model?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceSettings {
  provider: ProviderPreference;
  timezone: string;
  voiceEnabled: boolean;
  backgroundIntelligenceEnabled: boolean;
  dailyBriefEnabled: boolean;
  settings: Record<string, unknown>;
}

export interface ProviderUsageRecord {
  id: string;
  provider: string;
  model: string;
  taskType: string;
  latencyMs?: number;
  success: boolean;
  createdAt: string;
}

export interface WorkspaceRepository {
  readonly userId: string;
  listConversations(limit?: number): Promise<ConversationRecord[]>;
  createConversation(title?: string, provider?: ProviderId): Promise<ConversationRecord>;
  listMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  recentMessages(limit?: number): Promise<MessageRecord[]>;
  appendMessage(input: Omit<MessageRecord, "id" | "createdAt">): Promise<MessageRecord>;
  listBriefs(limit?: number): Promise<Record<string, unknown>[]>;
  saveBrief(input: { cadence: string; title: string; summary: string; content: Record<string, unknown>; provider?: string; model?: string }): Promise<void>;
  listGoals(): Promise<Goal[]>;
  upsertGoal(goal: Partial<Goal> & { title: string; id?: string }): Promise<Goal>;
  listHistory(limit?: number): Promise<Record<string, unknown>[]>;
  listProviderUsage(limit?: number): Promise<ProviderUsageRecord[]>;
  recordProviderUsage(input: Omit<ProviderUsageRecord, "id" | "createdAt">): Promise<void>;
  recordTrajectory(state: TrajectoryState): Promise<void>;
  getSettings(): Promise<WorkspaceSettings>;
  updateSettings(input: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>;
  recordVoice(input: { conversationId?: string; transcript: string; responseText?: string; provider?: string; model?: string; durationMs?: number; status: string; errorCode?: string }): Promise<void>;
}

type Row = Record<string, unknown>;

class SupabaseWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly client: SupabaseClient,
    readonly userId: string,
  ) {}

  async listConversations(limit = 50) {
    const { data, error } = await this.client
      .from("conversations")
      .select("*")
      .eq("user_id", this.userId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(limit, 100));
    if (error) throw new Error(`conversations: ${error.message}`);
    return (data ?? []).map(mapConversation);
  }

  async createConversation(title = "New conversation", provider?: ProviderId) {
    const { data, error } = await this.client
      .from("conversations")
      .insert({ user_id: this.userId, title: title.slice(0, 120), provider: provider ?? null })
      .select("*")
      .single();
    if (error) throw new Error(`create conversation: ${error.message}`);
    return mapConversation(data);
  }

  async listMessages(conversationId: string, limit = 100) {
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("user_id", this.userId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(Math.min(limit, 250));
    if (error) throw new Error(`messages: ${error.message}`);
    return (data ?? []).map(mapMessage);
  }

  async recentMessages(limit = 20) {
    const { data, error } = await this.client.from("messages").select("*")
      .eq("user_id", this.userId).order("created_at", { ascending: false }).limit(Math.min(limit, 40));
    if (error) throw new Error(`recent messages: ${error.message}`);
    return (data ?? []).reverse().map(mapMessage);
  }

  async appendMessage(input: Omit<MessageRecord, "id" | "createdAt">) {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("messages")
      .insert({
        user_id: this.userId,
        conversation_id: input.conversationId,
        role: input.role,
        content: input.content,
        provider: input.provider ?? null,
        model: input.model ?? null,
        metadata: input.metadata,
        created_at: now,
      })
      .select("*")
      .single();
    if (error) throw new Error(`append message: ${error.message}`);
    await this.client
      .from("conversations")
      .update({ last_message_at: now, updated_at: now })
      .eq("id", input.conversationId)
      .eq("user_id", this.userId);
    return mapMessage(data);
  }

  async listBriefs(limit = 30) {
    const { data, error } = await this.client
      .from("daily_briefs")
      .select("id, brief_date, cadence, title, summary, content, provider, model, created_at")
      .eq("user_id", this.userId)
      .order("brief_date", { ascending: false })
      .limit(Math.min(limit, 100));
    if (error) throw new Error(`daily briefs: ${error.message}`);
    return data ?? [];
  }

  async saveBrief(input: { cadence: string; title: string; summary: string; content: Record<string, unknown>; provider?: string; model?: string }) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const { error } = await this.client.from("daily_briefs").upsert({
      user_id: this.userId,
      brief_date: date,
      cadence: input.cadence,
      title: input.title,
      summary: input.summary,
      content: input.content,
      provider: input.provider ?? null,
      model: input.model ?? null,
    }, { onConflict: "user_id,brief_date,cadence" });
    if (error) throw new Error(`save brief: ${error.message}`);
  }

  async listGoals() {
    const { data, error } = await this.client
      .from("goals")
      .select("*")
      .eq("owner_id", this.userId)
      .order("priority", { ascending: true });
    if (error) throw new Error(`goals: ${error.message}`);
    return (data ?? []).map(mapGoal);
  }

  async upsertGoal(goal: Partial<Goal> & { title: string; id?: string }) {
    const row = {
      ...(goal.id ? { id: goal.id } : {}),
      owner_id: this.userId,
      title: goal.title,
      description: goal.description ?? null,
      horizon: goal.horizon ?? "quarter",
      target: goal.target ?? null,
      priority: goal.priority ?? 3,
      status: goal.status ?? "active",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.client.from("goals").upsert(row).select("*").single();
    if (error) throw new Error(`upsert goal: ${error.message}`);
    return mapGoal(data);
  }

  async listHistory(limit = 100) {
    const { data, error } = await this.client
      .from("trajectory_history")
      .select("*")
      .eq("user_id", this.userId)
      .order("observed_at", { ascending: false })
      .limit(Math.min(limit, 250));
    if (error) throw new Error(`trajectory history: ${error.message}`);
    return data ?? [];
  }

  async listProviderUsage(limit = 50) {
    const { data, error } = await this.client.from("provider_usage")
      .select("id, provider, model, task_type, latency_ms, success, created_at")
      .eq("user_id", this.userId).order("created_at", { ascending: false }).limit(Math.min(limit, 100));
    if (error) throw new Error(`provider usage: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id, provider: row.provider, model: row.model, taskType: row.task_type,
      latencyMs: row.latency_ms ?? undefined, success: row.success, createdAt: row.created_at,
    }));
  }

  async recordProviderUsage(input: Omit<ProviderUsageRecord, "id" | "createdAt">) {
    const { error } = await this.client.from("provider_usage").insert({
      user_id: this.userId, provider: input.provider, model: input.model,
      task_type: input.taskType, latency_ms: input.latencyMs ?? null, success: input.success,
    });
    if (error) throw new Error(`provider usage: ${error.message}`);
  }

  async recordTrajectory(state: TrajectoryState) {
    const opportunityCost = state.outlook?.decay[0]?.expectedDelta;
    const { error } = await this.client.from("trajectory_history").insert({
      user_id: this.userId,
      observed_at: state.computedAt,
      direction: state.trajectory,
      score: state.commercialMomentum,
      risk_level: state.riskLevel,
      current_constraint: state.bottleneck?.title ?? null,
      recommendation: state.recommendedAction?.title ?? null,
      confidence: state.outlook?.confidence ?? null,
      expected_impact: state.outlook?.expectedTrajectoryChange ?? null,
      urgency: state.signals.candidates[0]?.urgency ?? null,
      opportunity_cost: opportunityCost ?? null,
      snapshot: state,
    });
    if (error) throw new Error(`trajectory history: ${error.message}`);
  }

  async getSettings(): Promise<WorkspaceSettings> {
    const [{ data: profile }, { data: settings, error }] = await Promise.all([
      this.client.from("profiles").select("provider").eq("id", this.userId).single(),
      this.client.from("user_settings").select("*").eq("user_id", this.userId).single(),
    ]);
    if (error) throw new Error(`settings: ${error.message}`);
    return {
      provider: (profile?.provider as ProviderPreference) ?? "auto",
      timezone: settings.timezone,
      voiceEnabled: settings.voice_enabled,
      backgroundIntelligenceEnabled: settings.background_intelligence_enabled,
      dailyBriefEnabled: settings.daily_brief_enabled,
      settings: settings.settings ?? {},
    };
  }

  async updateSettings(input: Partial<WorkspaceSettings>) {
    if (input.provider) {
      const { error } = await this.client
        .from("profiles")
        .update({ provider: input.provider, updated_at: new Date().toISOString() })
        .eq("id", this.userId);
      if (error) throw new Error(`provider setting: ${error.message}`);
    }
    const update: Row = { updated_at: new Date().toISOString() };
    if (input.provider) update.provider_mode = input.provider;
    if (input.timezone) update.timezone = input.timezone;
    if (typeof input.voiceEnabled === "boolean") update.voice_enabled = input.voiceEnabled;
    if (typeof input.backgroundIntelligenceEnabled === "boolean") update.background_intelligence_enabled = input.backgroundIntelligenceEnabled;
    if (typeof input.dailyBriefEnabled === "boolean") update.daily_brief_enabled = input.dailyBriefEnabled;
    if (input.settings) update.settings = input.settings;
    const { error } = await this.client.from("user_settings").update(update).eq("user_id", this.userId);
    if (error) throw new Error(`settings: ${error.message}`);
    return this.getSettings();
  }

  async recordVoice(input: { conversationId?: string; transcript: string; responseText?: string; provider?: string; model?: string; durationMs?: number; status: string; errorCode?: string }) {
    const { error } = await this.client.from("voice_sessions").insert({
      user_id: this.userId,
      conversation_id: input.conversationId ?? null,
      transcript: input.transcript,
      response_text: input.responseText ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      duration_ms: input.durationMs ?? null,
      status: input.status,
      error_code: input.errorCode ?? null,
    });
    if (error) throw new Error(`voice session: ${error.message}`);
  }
}

class SeedWorkspaceRepository implements WorkspaceRepository {
  readonly userId = config.ownerId;
  async listConversations() { return []; }
  async createConversation(title = "New conversation", provider?: ProviderId) { return { id: crypto.randomUUID(), title, status: "active" as const, provider, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
  async listMessages() { return []; }
  async recentMessages() { return []; }
  async appendMessage(input: Omit<MessageRecord, "id" | "createdAt">) { return { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }; }
  async listBriefs() { return []; }
  async saveBrief() {}
  async listGoals() { return []; }
  async upsertGoal(goal: Partial<Goal> & { title: string; id?: string }) { return { id: goal.id ?? crypto.randomUUID(), title: goal.title, description: goal.description, horizon: goal.horizon ?? "quarter", target: goal.target, priority: goal.priority ?? 3, status: goal.status ?? "active" }; }
  async listHistory() { return []; }
  async listProviderUsage() { return []; }
  async recordProviderUsage() {}
  async recordTrajectory() {}
  async getSettings(): Promise<WorkspaceSettings> { return { provider: config.defaultProvider, timezone: config.timezone, voiceEnabled: true, backgroundIntelligenceEnabled: true, dailyBriefEnabled: true, settings: {} }; }
  async updateSettings(input: Partial<WorkspaceSettings>) { return { ...(await this.getSettings()), ...input }; }
  async recordVoice() {}
}

const seedWorkspace = new SeedWorkspaceRepository();

export async function getWorkspaceRepository(): Promise<WorkspaceRepository> {
  if (!hasSupabase()) return seedWorkspace;
  if (!config.authEnabled) {
    return hasSupabaseAdmin()
      ? new SupabaseWorkspaceRepository(createAdminClient(), config.ownerId)
      : seedWorkspace;
  }
  const [user, client] = await Promise.all([requireUser(), createClient()]);
  return new SupabaseWorkspaceRepository(client, user.id);
}

export function getWorkspaceRepositoryForUser(userId: string): WorkspaceRepository {
  if (!hasSupabaseAdmin()) return seedWorkspace;
  return new SupabaseWorkspaceRepository(createAdminClient(), userId);
}

function mapConversation(row: Row): ConversationRecord {
  return { id: row.id as string, title: row.title as string, status: row.status as ConversationRecord["status"], provider: (row.provider as ProviderId) ?? undefined, createdAt: row.created_at as string, updatedAt: row.updated_at as string, lastMessageAt: (row.last_message_at as string) ?? undefined };
}

function mapMessage(row: Row): MessageRecord {
  return { id: row.id as string, conversationId: row.conversation_id as string, role: row.role as MessageRecord["role"], content: row.content as string, provider: (row.provider as string) ?? undefined, model: (row.model as string) ?? undefined, metadata: (row.metadata as Record<string, unknown>) ?? {}, createdAt: row.created_at as string };
}

function mapGoal(row: Row): Goal {
  return { id: row.id as string, title: row.title as string, description: (row.description as string) ?? undefined, horizon: row.horizon as Goal["horizon"], target: (row.target as string) ?? undefined, priority: row.priority as number, status: row.status as Goal["status"] };
}
