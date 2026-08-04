import {
  TrajectoryExperience,
  type ExperienceState,
} from "@/components/trajectory/trajectory-experience";
import { config } from "@/lib/config";
import { providerOptions } from "@/lib/providers";
import { computeState } from "@/lib/state/compute";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const providers = providerOptions();
  const preferredProvider = user?.provider && user.provider !== "auto"
    && !providers.find((provider) => provider.id === user.provider)?.configured
    ? "auto"
    : user?.provider;
  const state = await computeState({
    persist: true,
    provider: preferredProvider,
    ownerName: user?.displayName,
  });
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

  return (
    <TrajectoryExperience
      ownerName={user?.displayName ?? config.ownerName}
      state={experienceState}
      providers={providers}
      defaultProvider={preferredProvider ?? state.provider ?? config.defaultProvider}
    />
  );
}
