export const trajectoryLanguage = {
  brand: {
    name: "Trajectory",
    descriptor: "Persistent executive intelligence",
    homeLabel: "Trajectory home",
    intelligenceRegion: "Trajectory intelligence",
  },
  loadingStates: {
    observing: "Observing…",
    updatingTrajectory: "Updating trajectory…",
    measuringMomentum: "Measuring momentum…",
    trackingMovement: "Tracking movement…",
    resolvingConstraints: "Resolving constraints…",
    integratingObservations: "Integrating observations…",
    updatingProjection: "Updating projection…",
    identifyingLeverage: "Identifying leverage…",
    mappingPossibilities: "Mapping possibilities…",
    followingEvolution: "Following evolution…",
    adjustingCourse: "Adjusting course…",
    stabilising: "Stabilising…",
    converging: "Converging…",
  },
  headings: {
    currentDynamics: "Current dynamics",
    executiveSignal: "Executive signal",
    highestLeverageRecommendation: "Highest-leverage recommendation",
    currentObservation: "Current observation",
    expectedMovement: "Expected movement",
    trajectoryLogic: "Trajectory logic",
    dailySummary: "Daily summary",
    voice: "Voice",
  },
  status: {
    observingQuietly: "Observing quietly",
    leverageEmerging: "A higher-leverage path is emerging",
    speaking: "Trajectory is speaking",
    listening: "Listening",
    voiceUnavailable: "Voice unavailable",
    idle: "Observing",
    loading: "Integrating observations",
    unsupported: "Unavailable",
  },
  voice: {
    listening: "I’m listening.",
    speakToTrajectory: "Speak to Trajectory",
    stopInteraction: "Stop voice interaction",
    tapToSpeak: "Tap the orb to speak",
    tapToStop: "Tap the orb to stop",
    unavailableInBrowser: "Voice unavailable in this browser",
    proactiveBrief: "Proactive brief · interrupt any time",
    briefMe: "Brief my trajectory",
    stop: "Stop",
    heardPrefix: "Observed:",
    empty: "Voice draws from the same live state as the executive view.",
    unsupported: "This browser cannot deliver spoken output. The written briefing remains available.",
    failure: "Trajectory could not prepare the briefing. Please try again.",
  },
  trajectory: {
    accelerating: "Your trajectory is strengthening.",
    steady: "Your trajectory is holding steady.",
    slipping: "Momentum is beginning to soften.",
    stalled: "Your trajectory needs a deliberate reset.",
    noConstraint: "No material constraint is blocking movement.",
    awaitingMeasurement: "Trajectory impact will be measured after the next state update.",
    withinNoise: "The expected change is currently within the model’s noise floor.",
    preserveLeverage: "Trajectory is observing the current signals and preserving the highest-leverage path.",
    continueObserving: "Continue observing your trajectory",
    leverageReady: "The highest-leverage action is ready.",
  },
  feedback: {
    positive: "Directional momentum is strengthening.",
    neutral: "Current movement remains stable.",
    attention: "A constraint is beginning to shape the path.",
    critical: "Immediate course correction is required.",
  },
  notifications: {
    trajectoryUpdated: "Trajectory updated.",
    projectionUpdated: "Projection updated.",
    observationIntegrated: "Observation integrated.",
  },
  dailySummary: {
    title: "Daily summary",
    empty: "Today’s movement will appear as observations accumulate.",
    ready: "Today’s directional summary is ready.",
  },
  onboarding: {
    title: "Live alongside your future.",
    subtitle: "Trajectory observes evolving systems, preserves continuity, and surfaces the next highest-leverage move.",
  },
  errors: {
    generic: "Trajectory could not complete this update.",
    retry: "Please try again.",
    voiceBrief: "Trajectory could not prepare the briefing.",
  },
  success: {
    saved: "Observation preserved.",
    connected: "System connected.",
    updated: "Trajectory updated.",
  },
  emptyStates: {
    noSignals: "No material signals have emerged yet.",
    noChanges: "No meaningful movement has been detected.",
    noActions: "No immediate intervention is required.",
  },
  motion: {
    principles: {
      pace: "slow over fast",
      character: "elegant over dramatic",
      atmosphere: "atmospheric over decorative",
      intent: "purposeful over distracting",
      restraint: "minimal over excessive",
    },
    labels: {
      splash: "Cinematic trajectory arrival",
      ambientBackground: "Ambient environmental movement",
      shootingStars: "Subtle directional crossings",
      voiceOrb: "Atmospheric voice presence",
      pageTransition: "Continuous page transition",
      pullToRefresh: "Trajectory refresh",
      success: "Directional confirmation",
      dynamicIsland: "Compact trajectory presence",
    },
  },
} as const;

export type TrajectoryLanguage = typeof trajectoryLanguage;

export const contextualLoadingStates = Object.values(trajectoryLanguage.loadingStates);

export function selectLoadingState(index: number) {
  return contextualLoadingStates[Math.abs(index) % contextualLoadingStates.length];
}
