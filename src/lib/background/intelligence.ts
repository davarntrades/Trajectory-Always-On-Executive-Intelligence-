import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeState } from "@/lib/state/compute";
import { getStoreForUser } from "@/lib/store";
import { getWorkspaceRepositoryForUser } from "@/lib/workspace/repository";
import type { ProviderPreference } from "@/lib/providers/types";

export interface BackgroundRunSummary {
  users: number;
  generated: number;
  unchanged: number;
  failed: number;
}

export async function runBackgroundIntelligence(): Promise<BackgroundRunSummary> {
  const admin = createAdminClient();
  const { data: profiles, error } = await admin.from("profiles").select("id, display_name, provider");
  if (error) throw new Error(`background profiles: ${error.message}`);
  const ids = (profiles ?? []).map((profile) => profile.id);
  const { data: settings } = ids.length
    ? await admin.from("user_settings").select("user_id, background_intelligence_enabled").in("user_id", ids)
    : { data: [] };
  const enabled = new Map((settings ?? []).map((row) => [row.user_id, row.background_intelligence_enabled]));
  const summary: BackgroundRunSummary = { users: ids.length, generated: 0, unchanged: 0, failed: 0 };

  for (const profile of profiles ?? []) {
    if (enabled.get(profile.id) === false) continue;
    try {
      const result = await runForUser(profile.id, profile.display_name, profile.provider as ProviderPreference);
      summary[result === "generated" ? "generated" : "unchanged"] += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("background intelligence failed", { userId: profile.id, error });
    }
  }
  return summary;
}

async function runForUser(userId: string, displayName: string, provider: ProviderPreference) {
  const admin = createAdminClient();
  const store = getStoreForUser(userId);
  const repository = getWorkspaceRepositoryForUser(userId);
  const [events, tasks, goals, opportunities] = await Promise.all([
    store.events(7), store.tasks(), store.goals(), store.opportunities(),
  ]);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ events, tasks, goals, opportunities }))
    .digest("hex");
  const { data: job, error: jobError } = await admin.from("background_jobs").insert({
    user_id: userId,
    job_type: "executive-signal",
    source_fingerprint: fingerprint,
    status: "running",
  }).select("id").single();
  if (jobError?.code === "23505") return "unchanged" as const;
  if (jobError || !job) throw new Error(`background job: ${jobError?.message ?? "missing job"}`);

  try {
    const reasoningStartedAt = Date.now();
    const state = await computeState({ store, ownerName: displayName, provider, persist: true });
    const recommendation = state.recommendedAction?.title ?? state.todaysObjective;
    const why = state.recommendedAction?.why || state.reasoning || "This is the highest-leverage path in the current evidence.";
    const urgency = state.signals.candidates[0]?.urgency ?? null;
    const opportunityCost = state.outlook?.decay[0]?.expectedDelta ?? null;
    await Promise.all([
      repository.recordTrajectory(state),
      repository.saveBrief({
        cadence: "morning",
        title: "Executive brief",
        summary: recommendation,
        content: { recommendation, why, constraint: state.bottleneck?.title, outlook: state.outlook },
        provider: state.provider,
        model: state.model,
      }),
      ...(state.provider && state.model ? [repository.recordProviderUsage({
        provider: state.provider,
        model: state.model,
        taskType: "executive-signal",
        latencyMs: Date.now() - reasoningStartedAt,
        success: true,
      })] : []),
      admin.from("executive_signals").insert({
        user_id: userId,
        highest_leverage_recommendation: recommendation,
        why_it_matters: why,
        current_constraint: state.bottleneck?.title ?? null,
        confidence: state.outlook?.confidence ?? 0.5,
        expected_trajectory_impact: state.outlook?.expectedTrajectoryChange ?? null,
        suggested_next_action: recommendation,
        urgency,
        opportunity_cost: opportunityCost,
        source_fingerprint: fingerprint,
        provider: state.provider ?? null,
        model: state.model ?? null,
      }),
    ]);
    await admin.from("background_jobs").update({ status: "succeeded", result: { recommendation }, completed_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", userId);
    return "generated" as const;
  } catch (error) {
    await admin.from("background_jobs").update({ status: "failed", error: error instanceof Error ? error.message : "unknown error", completed_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", userId);
    throw error;
  }
}
