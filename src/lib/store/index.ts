/**
 * Data access.
 *
 * One interface, two backends. When Supabase env vars are present the queries
 * hit Postgres; otherwise the seed dataset is served from memory. Everything
 * upstream — state engine, reasoner, UI — is written against the interface and
 * does not know or care which backend answered.
 */

import { config, hasSupabase } from "@/lib/config";
import type {
  AuditEntry,
  CalendarEntry,
  Entity,
  Goal,
  Memory,
  Opportunity,
  Project,
  Relationship,
  Task,
  TrajectoryAction,
  TrajectoryEvent,
  TrajectoryState,
} from "@/lib/types";
import {
  seedCalendar,
  seedEntities,
  seedEvents,
  seedGoals,
  seedMemories,
  seedOpportunities,
  seedProjects,
  seedRelationships,
  seedTasks,
} from "./seed";

export interface TrajectoryStore {
  entities(): Promise<Entity[]>;
  relationships(): Promise<Relationship[]>;
  goals(): Promise<Goal[]>;
  projects(): Promise<Project[]>;
  tasks(): Promise<Task[]>;
  opportunities(): Promise<Opportunity[]>;
  events(sinceDays?: number): Promise<TrajectoryEvent[]>;
  memories(): Promise<Memory[]>;
  calendar(): Promise<CalendarEntry[]>;

  appendEvents(events: TrajectoryEvent[]): Promise<number>;
  saveSnapshot(state: TrajectoryState): Promise<void>;
  latestSnapshot(): Promise<TrajectoryState | null>;

  actions(): Promise<TrajectoryAction[]>;
  saveAction(action: TrajectoryAction): Promise<void>;
  auditLog(limit?: number): Promise<AuditEntry[]>;
  appendAudit(entry: Omit<AuditEntry, "id">): Promise<void>;
}

// ---------------------------------------------------------------------------
// Seed-backed store
// ---------------------------------------------------------------------------

/**
 * Mutable in-process state. Survives for the lifetime of the server process,
 * which is enough to demonstrate ingestion, action approval and audit without
 * a database. Restarting resets to seed.
 */
const memoryState = {
  events: [...seedEvents],
  snapshots: [] as TrajectoryState[],
  actions: [] as TrajectoryAction[],
  audit: [] as AuditEntry[],
};

class SeedStore implements TrajectoryStore {
  async entities() {
    return seedEntities;
  }
  async relationships() {
    return seedRelationships;
  }
  async goals() {
    return seedGoals;
  }
  async projects() {
    return seedProjects;
  }
  async tasks() {
    return seedTasks;
  }
  async opportunities() {
    return seedOpportunities;
  }
  async events(sinceDays = 30) {
    const cutoff = Date.now() - sinceDays * 864e5;
    return memoryState.events
      .filter((e) => new Date(e.occurredAt).getTime() >= cutoff)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  async memories() {
    return seedMemories;
  }
  async calendar() {
    return seedCalendar;
  }

  async appendEvents(events: TrajectoryEvent[]) {
    // De-duplicate on (source, externalId) the same way the unique index does.
    const seen = new Set(
      memoryState.events
        .filter((e) => e.externalId)
        .map((e) => `${e.source}:${e.externalId}`),
    );
    const fresh = events.filter((e) => {
      if (!e.externalId) return true;
      const key = `${e.source}:${e.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    memoryState.events.push(...fresh);
    return fresh.length;
  }

  async saveSnapshot(state: TrajectoryState) {
    memoryState.snapshots.unshift(state);
    memoryState.snapshots = memoryState.snapshots.slice(0, 50);
  }
  async latestSnapshot() {
    return memoryState.snapshots[0] ?? null;
  }

  async actions() {
    return memoryState.actions;
  }
  async saveAction(action: TrajectoryAction) {
    const i = memoryState.actions.findIndex((a) => a.id === action.id);
    if (i >= 0) memoryState.actions[i] = action;
    else memoryState.actions.unshift(action);
  }
  async auditLog(limit = 100) {
    return memoryState.audit.slice(0, limit);
  }
  async appendAudit(entry: Omit<AuditEntry, "id">) {
    memoryState.audit.unshift({ ...entry, id: crypto.randomUUID() });
  }
}

// ---------------------------------------------------------------------------
// Supabase-backed store
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class SupabaseStore implements TrajectoryStore {
  // Lazily constructed so the module never imports a client that can't be built.
  private clientPromise: Promise<
    import("@supabase/supabase-js").SupabaseClient
  > | null = null;

  private client() {
    if (!this.clientPromise) {
      this.clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
        createClient(
          config.supabaseUrl!,
          config.supabaseServiceKey ?? config.supabaseAnonKey!,
          { auth: { persistSession: false } },
        ),
      );
    }
    return this.clientPromise;
  }

  private async select(table: string, build?: (q: never) => unknown): Promise<Row[]> {
    const sb = await this.client();
    let q = sb.from(table).select("*").eq("owner_id", config.ownerId);
    if (build) q = build(q as never) as typeof q;
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row[];
  }

  async entities() {
    return (await this.select("entities")).map(mapEntity);
  }
  async relationships() {
    return (await this.select("relationships")).map((r) => ({
      id: r.id as string,
      fromId: r.from_id as string,
      toId: r.to_id as string,
      kind: r.kind as string,
      strength: (r.strength as number) ?? 0.5,
    }));
  }
  async goals() {
    return (await this.select("goals")) as unknown as Goal[];
  }
  async projects() {
    return (await this.select("projects")).map((p) => ({
      id: p.id as string,
      goalId: (p.goal_id as string) ?? undefined,
      name: p.name as string,
      description: (p.description as string) ?? undefined,
      status: p.status as Project["status"],
      priority: (p.priority as number) ?? 3,
      valueScore: (p.value_score as number) ?? 0.5,
    }));
  }
  async tasks() {
    return (await this.select("tasks")).map(mapTask);
  }
  async opportunities() {
    return (await this.select("opportunities")).map(mapOpportunity);
  }
  async events(sinceDays = 30) {
    const cutoff = new Date(Date.now() - sinceDays * 864e5).toISOString();
    const sb = await this.client();
    const { data, error } = await sb
      .from("events")
      .select("*")
      .eq("owner_id", config.ownerId)
      .gte("occurred_at", cutoff)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(`events: ${error.message}`);
    return (data ?? []).map(mapEvent);
  }
  async memories() {
    return (await this.select("memories")).map(mapMemory);
  }
  async calendar() {
    // Calendar entries arrive as events until the Google Calendar connector
    // lands in Phase 2; project them into the read model here.
    const evts = await this.events(14);
    return evts
      .filter((e) => e.type.startsWith("calendar."))
      .map((e) => ({
        id: e.id,
        title: e.title,
        startAt: (e.payload.startAt as string) ?? e.occurredAt,
        endAt: (e.payload.endAt as string) ?? e.occurredAt,
        attendees: (e.payload.attendees as string[]) ?? [],
        location: e.payload.location as string | undefined,
      }));
  }

  async appendEvents(events: TrajectoryEvent[]) {
    if (!events.length) return 0;
    const sb = await this.client();
    const { data, error } = await sb
      .from("events")
      .upsert(
        events.map((e) => ({
          owner_id: config.ownerId,
          source: e.source,
          type: e.type,
          title: e.title,
          body: e.body,
          occurred_at: e.occurredAt,
          entity_ids: e.entityIds,
          project_id: e.projectId ?? null,
          external_id: e.externalId ?? null,
          payload: e.payload,
        })),
        { onConflict: "source,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(`appendEvents: ${error.message}`);
    return data?.length ?? 0;
  }

  async saveSnapshot(state: TrajectoryState) {
    const sb = await this.client();
    const { error } = await sb.from("state_snapshots").insert({
      owner_id: config.ownerId,
      computed_at: state.computedAt,
      trajectory: state.trajectory,
      risk_level: state.riskLevel,
      commercial_momentum: state.commercialMomentum,
      project_momentum: state.signals.projectMomentum,
      bottleneck: state.bottleneck ?? null,
      recommended_action: state.recommendedAction ?? null,
      reasoning: state.reasoning,
      signals: state.signals,
      model: state.model ?? null,
    });
    if (error) throw new Error(`saveSnapshot: ${error.message}`);
  }

  async latestSnapshot() {
    const sb = await this.client();
    const { data, error } = await sb
      .from("state_snapshots")
      .select("*")
      .eq("owner_id", config.ownerId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`latestSnapshot: ${error.message}`);
    if (!data) return null;
    return {
      computedAt: data.computed_at,
      trajectory: data.trajectory,
      riskLevel: data.risk_level,
      commercialMomentum: data.commercial_momentum,
      bottleneck: data.bottleneck ?? undefined,
      recommendedAction: data.recommended_action ?? undefined,
      reasoning: data.reasoning ?? "",
      todaysObjective: data.signals?.todaysObjective ?? "",
      signals: data.signals,
      model: data.model ?? undefined,
    } as TrajectoryState;
  }

  async actions() {
    const rows = await this.select("actions");
    return rows.map((a) => ({
      id: a.id as string,
      connectorId: (a.connector_id as string) ?? undefined,
      capability: a.capability as string,
      tier: a.tier as TrajectoryAction["tier"],
      status: a.status as TrajectoryAction["status"],
      summary: a.summary as string,
      payload: (a.payload as Record<string, unknown>) ?? {},
      rationale: (a.rationale as string) ?? undefined,
      createdAt: a.created_at as string,
    }));
  }

  async saveAction(action: TrajectoryAction) {
    const sb = await this.client();
    const { error } = await sb.from("actions").upsert({
      id: action.id,
      owner_id: config.ownerId,
      connector_id: action.connectorId ?? null,
      capability: action.capability,
      tier: action.tier,
      status: action.status,
      summary: action.summary,
      payload: action.payload,
      rationale: action.rationale ?? null,
      created_at: action.createdAt,
    });
    if (error) throw new Error(`saveAction: ${error.message}`);
  }

  async auditLog(limit = 100) {
    const sb = await this.client();
    const { data, error } = await sb
      .from("audit_log")
      .select("*")
      .eq("owner_id", config.ownerId)
      .order("at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`auditLog: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      actionId: r.action_id ?? undefined,
      at: r.at,
      actor: r.actor,
      event: r.event,
      tier: r.tier ?? undefined,
      detail: r.detail ?? {},
    })) as AuditEntry[];
  }

  async appendAudit(entry: Omit<AuditEntry, "id">) {
    const sb = await this.client();
    const { error } = await sb.from("audit_log").insert({
      owner_id: config.ownerId,
      action_id: entry.actionId ?? null,
      at: entry.at,
      actor: entry.actor,
      event: entry.event,
      tier: entry.tier ?? null,
      detail: entry.detail,
    });
    if (error) throw new Error(`appendAudit: ${error.message}`);
  }
}

// --- row mappers -----------------------------------------------------------

function mapEntity(e: Row): Entity {
  return {
    id: e.id as string,
    kind: e.kind as Entity["kind"],
    name: e.name as string,
    aliases: (e.aliases as string[]) ?? [],
    summary: (e.summary as string) ?? undefined,
    attributes: (e.attributes as Record<string, unknown>) ?? {},
    salience: (e.salience as number) ?? 0.5,
    lastSeenAt: e.last_seen_at as string,
  };
}

function mapTask(t: Row): Task {
  return {
    id: t.id as string,
    projectId: (t.project_id as string) ?? undefined,
    title: t.title as string,
    detail: (t.detail as string) ?? undefined,
    status: t.status as Task["status"],
    effortHours: (t.effort_hours as number) ?? 1,
    impact: (t.impact as number) ?? 0.5,
    dueAt: (t.due_at as string) ?? undefined,
    blockedBy: (t.blocked_by as string[]) ?? [],
    waitingOn: (t.waiting_on as string) ?? undefined,
    waitingSince: (t.waiting_since as string) ?? undefined,
    source: (t.source as string) ?? undefined,
  };
}

function mapOpportunity(o: Row): Opportunity {
  return {
    id: o.id as string,
    companyId: (o.company_id as string) ?? undefined,
    contactId: (o.contact_id as string) ?? undefined,
    name: o.name as string,
    stage: o.stage as string,
    value: Number(o.value ?? 0),
    currency: (o.currency as string) ?? "GBP",
    probability: (o.probability as number) ?? 0.2,
    lastContactAt: (o.last_contact_at as string) ?? undefined,
    expectedReplyDays: (o.expected_reply_days as number) ?? 5,
    nextStep: (o.next_step as string) ?? undefined,
  };
}

function mapEvent(e: Row): TrajectoryEvent {
  return {
    id: e.id as string,
    source: e.source as string,
    type: e.type as string,
    title: e.title as string,
    body: (e.body as string) ?? undefined,
    occurredAt: e.occurred_at as string,
    entityIds: (e.entity_ids as string[]) ?? [],
    projectId: (e.project_id as string) ?? undefined,
    externalId: (e.external_id as string) ?? undefined,
    payload: (e.payload as Record<string, unknown>) ?? {},
  };
}

function mapMemory(m: Row): Memory {
  return {
    id: m.id as string,
    kind: m.kind as Memory["kind"],
    content: m.content as string,
    entityIds: (m.entity_ids as string[]) ?? [],
    confidence: (m.confidence as number) ?? 0.7,
    salience: (m.salience as number) ?? 0.5,
    occurredAt: m.occurred_at as string,
  };
}

// ---------------------------------------------------------------------------

let instance: TrajectoryStore | null = null;

export function getStore(): TrajectoryStore {
  if (!instance) {
    instance = hasSupabase() ? new SupabaseStore() : new SeedStore();
  }
  return instance;
}
