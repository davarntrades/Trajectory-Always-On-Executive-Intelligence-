import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

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
