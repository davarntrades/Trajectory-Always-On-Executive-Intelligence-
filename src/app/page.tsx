import {
  TrajectoryExperience,
  type ExperienceState,
} from "@/components/trajectory/trajectory-experience";
import { config } from "@/lib/config";
import { computeState } from "@/lib/state/compute";

export const dynamic = "force-dynamic";

export default async function Home() {
  const state = await computeState({ persist: true });
  const experienceState: ExperienceState = {
    computedAt: state.computedAt,
    trajectory: state.trajectory,
    riskLevel: state.riskLevel,
    meaningfulChanges: Math.max(1, Math.min(9, state.signals.eventsLast24h)),
    bottleneck: state.bottleneck?.title,
    action: state.recommendedAction
      ? {
          title: state.recommendedAction.title,
          why: state.recommendedAction.why,
        }
      : undefined,
    reasoning: state.reasoning,
    impact: state.outlook
      ? {
          change: state.outlook.expectedTrajectoryChange,
          horizonDays: state.outlook.horizonDays,
          withinNoise: state.outlook.withinNoise,
        }
      : undefined,
  };

  return <TrajectoryExperience ownerName={config.ownerName} state={experienceState} />;
}
