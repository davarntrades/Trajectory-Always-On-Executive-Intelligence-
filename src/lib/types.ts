/**
 * Shared domain types.
 *
 * These mirror the Supabase schema in `supabase/migrations/`. Every layer —
 * connectors, memory, state engine, reasoner, UI — speaks these types, which is
 * what lets a new connector be a single file with no changes elsewhere.
 */

export type EntityKind =
  | "person"
  | "company"
  | "project"
  | "product"
  | "tool"
  | "topic";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  summary?: string;
  attributes: Record<string, unknown>;
  salience: number;
  lastSeenAt: string;
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  strength: number;
}

export type Horizon = "week" | "month" | "quarter" | "year";

export interface Goal {
  id: string;
  title: string;
  description?: string;
  horizon: Horizon;
  target?: string;
  priority: number;
  status: "active" | "achieved" | "abandoned";
}

export interface Project {
  id: string;
  goalId?: string;
  name: string;
  description?: string;
  status: "active" | "paused" | "shipped" | "dropped";
  priority: number;
  /** 0..1 strategic value — feeds bottleneck downstream-value calculation. */
  valueScore: number;
}

export type TaskStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "done";

export interface Task {
  id: string;
  projectId?: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  effortHours: number;
  /** 0..1 */
  impact: number;
  dueAt?: string;
  blockedBy: string[];
  waitingOn?: string;
  waitingSince?: string;
  source?: string;
}

export interface Opportunity {
  id: string;
  companyId?: string;
  contactId?: string;
  name: string;
  stage: string;
  value: number;
  currency: string;
  probability: number;
  lastContactAt?: string;
  /** How long before silence from this counterparty is meaningful. */
  expectedReplyDays: number;
  nextStep?: string;
}

export interface TrajectoryEvent {
  id: string;
  source: string;
  type: string;
  title: string;
  body?: string;
  occurredAt: string;
  entityIds: string[];
  projectId?: string;
  externalId?: string;
  payload: Record<string, unknown>;
}

export type MemoryKind =
  | "episodic"
  | "semantic"
  | "decision"
  | "preference"
  | "mistake";

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  entityIds: string[];
  confidence: number;
  salience: number;
  occurredAt: string;
  embedding?: number[];
}

// --- State ----------------------------------------------------------------

export type TrajectoryDirection =
  | "accelerating"
  | "steady"
  | "slipping"
  | "stalled";

export type RiskLevel = "low" | "elevated" | "high" | "critical";

export interface ScoredCandidate {
  id: string;
  kind: "task" | "opportunity" | "unblock";
  title: string;
  leverage: number;
  impact: number;
  urgency: number;
  unblockFactor: number;
  effortHours: number;
  /** Human-readable trace of how leverage was computed. */
  factors: string[];
  projectId?: string;
}

export interface Bottleneck {
  id: string;
  kind: "task" | "opportunity" | "decision";
  title: string;
  blockingScore: number;
  downstreamValue: number;
  ageDays: number;
  dependencyCount: number;
  effortHours: number;
  blockedItems: string[];
}

export interface WaitingItem {
  id: string;
  title: string;
  waitingOn: string;
  daysWaiting: number;
  overdue: boolean;
}

export interface MomentumReading {
  projectId: string;
  projectName: string;
  /** Decayed, type-weighted event score. */
  score: number;
  /** Change vs the prior window. */
  delta: number;
  eventsInWindow: number;
  lastEventAt?: string;
  status: "hot" | "steady" | "cooling" | "stalled";
}

export interface StateSignals {
  projectMomentum: MomentumReading[];
  commercialMomentum: number;
  commercialDelta: number;
  candidates: ScoredCandidate[];
  waiting: WaitingItem[];
  blocked: Task[];
  outstandingCommitments: Task[];
  overdueCount: number;
  staleOpportunities: Opportunity[];
  eventsLast24h: number;
}

export interface RecommendedAction {
  title: string;
  why: string;
  leverage: number;
  candidateId: string;
  /** Which permission tier acting on this would require. */
  tier: ActionTier;
}

/**
 * Forward-looking view, produced by the simulator.
 *
 * Separate from `signals` because these are claims about the *future* and carry
 * a calibration status. Nothing here should be presented with the same
 * authority as a measured signal until predictions have been scored against
 * outcomes.
 */
export interface Outlook {
  horizonDays: number;
  /** P(primary objective on track at the horizon) under no intervention. */
  confidence: number;
  primaryObjective?: string;
  /** Relative improvement in trajectory value from the recommended action. */
  expectedTrajectoryChange: number;
  /** Monte Carlo standard error on that estimate. */
  standardError: number;
  /** True when the estimate is indistinguishable from sampling noise. */
  withinNoise: boolean;
  calibration: "calibrated" | "provisional" | "uncalibrated";
  objectiveOutlook: { label: string; onTrack: number }[];
  /** Value of the same action taken later — the cost of delay. */
  decay: { days: number; expectedDelta: number }[];
  trajectories: number;
  seed: number;
}

export interface TrajectoryState {
  computedAt: string;
  trajectory: TrajectoryDirection;
  riskLevel: RiskLevel;
  commercialMomentum: number;
  bottleneck?: Bottleneck;
  recommendedAction?: RecommendedAction;
  /** Narrative from the reasoner. Empty when running without an API key. */
  reasoning: string;
  todaysObjective: string;
  signals: StateSignals;
  /** Forward simulation. Absent when simulation is disabled or failed. */
  outlook?: Outlook;
  provider?: "anthropic" | "openai" | "gemini" | "grok" | "local";
  model?: string;
}

// --- Permissions & audit ---------------------------------------------------

export type ActionTier =
  | "observe"
  | "recommend"
  | "draft"
  | "approve"
  | "execute";

export type ActionStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface TrajectoryAction {
  id: string;
  connectorId?: string;
  capability: string;
  tier: ActionTier;
  status: ActionStatus;
  summary: string;
  payload: Record<string, unknown>;
  rationale?: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actionId?: string;
  at: string;
  actor: string;
  event: string;
  tier?: ActionTier;
  detail: Record<string, unknown>;
}

export interface PermissionPolicy {
  connectorId?: string;
  capability: string;
  maxTier: ActionTier;
}

// --- Connectors ------------------------------------------------------------

export interface Capability {
  id: string;
  description: string;
  /** Highest tier this capability may ever reach, regardless of policy. */
  maxTier: ActionTier;
}

export interface ConnectorContext {
  ownerId: string;
  since?: string;
  cursor?: string;
}

export interface SyncResult {
  events: TrajectoryEvent[];
  cursor?: string;
}

export interface Connector {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  /** True when credentials are present and the connector can reach its API. */
  isConfigured(): boolean;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
}

// --- Dashboard read models -------------------------------------------------

export interface FeedItem {
  id: string;
  source: string;
  type: string;
  title: string;
  body?: string;
  occurredAt: string;
}

export interface CalendarEntry {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  attendees: string[];
  location?: string;
}
