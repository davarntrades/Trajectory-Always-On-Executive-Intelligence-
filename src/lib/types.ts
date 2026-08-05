/* Domain types for Trajectory. */

export type TrajectoryDirection = "accelerating" | "steady" | "slipping" | "stalled";
export type RiskLevel = "low" | "elevated" | "high" | "critical";
export type ActionTier = "observe" | "recommend" | "draft" | "approve" | "execute";

export interface Bottleneck { id: string; title: string; blockingScore: number; effortHours: number; dependencyCount: number; blockedItems: string[]; }
export interface RecommendedAction { title: string; why: string; leverage: number; candidateId: string; tier: ActionTier; }
export interface StateSignals { candidates: Array<{ id: string; title: string; leverage: number; urgency: number; effortHours: number; kind: string; factors: string[] }>; projectMomentum: Array<{ projectName: string; score: number; delta: number; eventsInWindow: number; status: string }>; waiting: Array<{ title: string; daysWaiting: number; waitingOn: string; overdue: boolean }>; commercialDelta: number; eventsLast24h: number; overdueCount: number; }
export interface Outlook { horizonDays: number; confidence: number; primaryObjective?: string; expectedTrajectoryChange: number; standardError: number; withinNoise: boolean; calibration: "calibrated" | "provisional" | "uncalibrated"; objectiveOutlook: { label: string; onTrack: number }[]; decay: { days: number; expectedDelta: number }[]; trajectories: number; seed: number; }
export interface ProviderSignalFields { currentObservation: string; currentConstraint: string; expectedImpact: string; confidence: number; suggestedNextAction: string; urgency: number; }
export interface TrajectoryState { computedAt: string; trajectory: TrajectoryDirection; riskLevel: RiskLevel; commercialMomentum: number; bottleneck?: Bottleneck; recommendedAction?: RecommendedAction; reasoning: string; todaysObjective: string; signals: StateSignals; outlook?: Outlook; provider?: "anthropic" | "openai" | "gemini" | "grok" | "local"; model?: string; providerSignal?: ProviderSignalFields; }

export interface Memory { id: string; kind: string; content: string; createdAt?: string; }
export type ActionStatus = "proposed" | "awaiting_approval" | "approved" | "rejected" | "executed" | "failed";
export interface TrajectoryAction { id: string; connectorId?: string; capability: string; tier: ActionTier; status: ActionStatus; summary: string; payload: Record<string, unknown>; rationale?: string; createdAt: string; }
export interface AuditEntry { id: string; actionId?: string; event: string; detail: Record<string, unknown>; createdAt: string; }
