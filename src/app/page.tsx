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
  const preferredProvider = profile?.provider ?? user?.provider ?? config.defaultProvider;
  const ownerName = profile?.displayName ?? user?.displayName ?? config.ownerName;

  // Ordinary page rendering must never invoke an external provider. Provider
  // synthesis belongs to an explicit user interaction such as the voice route.
  // This keeps the root experience available when a key, model, or provider is
  // temporarily unavailable and prevents an external error from aborting SSR.
  const state = await computeState({ persist: true, deterministicOnly: true, ownerName });
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
    <TrajectoryExperience ownerName={ownerName} state={experienceState} providers={providers} defaultProvider={preferredProvider} />
    {profile ? <EntryExperiences initialProfile={profile} initialCheckIn={checkIn} showMorningCheckIn={showCheckIn} providers={providers} /> : null}
  </>;
}
