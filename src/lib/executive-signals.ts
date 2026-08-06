import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

export const ExecutiveSignalResponseSchema = z.object({
  id: z.string().uuid(),
  computedAt: z.string().min(1),
  highestLeverageRecommendation: z.string().trim().min(1),
  currentObservation: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
  expectedImpact: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  currentConstraint: z.string().trim().min(1),
  suggestedNextAction: z.string().trim().min(1),
  urgency: z.number().min(0).max(1),
  trajectory: z.enum(["accelerating", "steady", "slipping", "stalled"]),
  riskLevel: z.enum(["low", "elevated", "high", "critical"]),
  // Provenance for the work records this signal was permitted to reason from.
  // Optional so signals persisted before ingestion existed still parse.
  evidence: z
    .array(
      z.object({
        workItemId: z.string(),
        label: z.string(),
        status: z.enum(["open", "active", "blocked", "completed", "superseded"]),
        updatedAt: z.string(),
        url: z.string().optional(),
      }),
    )
    .optional(),
});

export type ExecutiveSignalResponse = z.infer<typeof ExecutiveSignalResponseSchema>;

export interface PersistedExecutiveSignalInput {
  requestId: string;
  highestLeverageRecommendation: string;
  currentObservation: string;
  reasoning: string;
  currentConstraint: string;
  confidence: number;
  expectedImpact: number | null;
  suggestedNextAction: string;
  urgency: number;
  sourceFingerprint: string;
  provider?: string;
  model?: string;
  morningCheckInId?: string;
}

export async function persistExecutiveSignal(input: PersistedExecutiveSignalInput) {
  const user = await requireUser();
  const client = await createClient();
  await client.from("executive_signals").update({ superseded_at: new Date().toISOString() }).eq("user_id", user.id).is("superseded_at", null);
  const { data, error } = await client.from("executive_signals").insert({
    user_id: user.id,
    highest_leverage_recommendation: input.highestLeverageRecommendation,
    why_it_matters: input.reasoning,
    current_observation: input.currentObservation,
    reasoning: input.reasoning,
    current_constraint: input.currentConstraint,
    confidence: input.confidence,
    expected_trajectory_impact: input.expectedImpact,
    suggested_next_action: input.suggestedNextAction,
    urgency: input.urgency,
    opportunity_cost: null,
    source_fingerprint: input.sourceFingerprint,
    request_id: input.requestId,
    provider: input.provider ?? null,
    model: input.model ?? null,
    morning_check_in_id: input.morningCheckInId ?? null,
  }).select("id, generated_at").single();
  if (error) throw new Error(`executive signal: ${error.message}`);
  return data;
}

export async function getLatestExecutiveSignal(): Promise<ExecutiveSignalResponse | null> {
  const user = await requireUser();
  const client = await createClient();
  const { data, error } = await client
    .from("messages")
    .select("metadata, created_at")
    .eq("user_id", user.id)
    .eq("role", "assistant")
    .not("metadata->executiveSignal", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(`latest executive signal: ${error.message}`);
  for (const row of data ?? []) {
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};
    const parsed = ExecutiveSignalResponseSchema.safeParse(metadata.executiveSignal);
    if (parsed.success) return parsed.data;
  }
  return null;
}
