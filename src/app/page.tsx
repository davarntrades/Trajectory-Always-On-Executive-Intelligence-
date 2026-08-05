import { TrajectoryExperience, type ExperienceState } from "@/components/trajectory/trajectory-experience";
import { EntryExperiences } from "@/components/trajectory/entry-experiences";
import { config } from "@/lib/config";
import { providerOptions } from "@/lib/providers";
import { computeState } from "@/lib/state/compute";
import { getCurrentUser } from "@/lib/auth/session";
import { getPersonalProfile, getTodayCheckIn, shouldShowMorningCheckIn } from "@/lib/personalization";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const providers = providerOptions();
  const profile = user ? await getPersonalProfile() : null;
  const checkIn = profile ? await getTodayCheckIn(profile) : null;
  const showCheckIn = profile ? await shouldShowMorningCheckIn(profile, checkIn) : false;
  const preferredProvider = profile?.provider && profile.provider !== "auto"
    && !providers.find((provider) => provider.id === profile.provider)?.configured
    ? "auto"
    : profile?.provider ?? user?.provider;
  const ownerName = profile?.displayName ?? user?.displayName ?? config.ownerName;
  const state = await computeState({ persist: true, provider: preferredProvider, ownerName });
  const experienceState: ExperienceState = {
    computedAt: state.computedAt,
    trajectory: state.trajectory,
    riskLevel: state.riskLevel,
    meaningfulChanges: Math.max(1, Math.min(9, state.signals.eventsLast24h)),
    bottleneck: state.bottleneck?.title,
    action: state.recommendedAction ? { title: state.recommendedAction.title, why: state.recommendedAction.why } : undefined,
    reasoning: state.reasoning,
    impact: state.outlook ? { change: state.outlook.expectedTrajectoryChange, horizonDays: state.outlook.horizonDays, withinNoise: state.outlook.withinNoise } : undefined,
  };

  return <>
    <TrajectoryExperience ownerName={ownerName} state={experienceState} providers={providers} defaultProvider={preferredProvider ?? state.provider ?? config.defaultProvider} />
    {profile ? <EntryExperiences initialProfile={profile} initialCheckIn={checkIn} showMorningCheckIn={showCheckIn} providers={providers} /> : null}
  </>;
}
