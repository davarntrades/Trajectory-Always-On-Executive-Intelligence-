export const trajectoryMotion = {
  principles: {
    duration: "slow",
    emphasis: "elegant",
    environment: "atmospheric",
    purpose: "directional",
    restraint: "minimal",
    bounce: false,
  },
  timing: {
    instant: 120,
    quick: 220,
    standard: 420,
    deliberate: 700,
    atmospheric: 1200,
    ambient: 6000,
  },
  easing: {
    enter: [0.22, 1, 0.36, 1],
    exit: [0.4, 0, 1, 1],
    ambient: [0.37, 0, 0.63, 1],
  },
  splash: {
    name: "cinematic-splash",
    duration: 2600,
    darknessHold: 900,
    starTravel: 900,
    identityReveal: 650,
    dissolve: 450,
  },
  starfield: {
    name: "ambient-starfield",
    farDriftDuration: 115000,
    nearDriftDuration: 80000,
    nebulaDriftDuration: 48000,
    opacityRange: [0.28, 0.62],
  },
  shootingStars: {
    name: "directional-crossing",
    duration: 2200,
    minimumInterval: 20000,
    maximumInterval: 40000,
  },
  voiceOrb: {
    name: "atmospheric-presence",
    idleDuration: 6200,
    listeningDuration: 2400,
    processingDuration: 3200,
    speakingDuration: 2200,
    settleDuration: 900,
  },
  executiveSignal: {
    name: "continuous-signal-transition",
    exitDuration: 240,
    crossingDuration: 900,
    enterDuration: 420,
  },
  pageTransition: {
    name: "continuous-page-transition",
    duration: 520,
    distance: 10,
  },
  pullToRefresh: {
    name: "trajectory-refresh",
    duration: 700,
  },
  loading: {
    name: "distant-star-pulse",
    duration: 2400,
  },
  success: {
    name: "constellation-confirmation",
    duration: 1000,
    scale: 1.015,
  },
  reducedMotion: {
    duration: 180,
    travelDistance: 0,
    ambientAnimation: false,
  },
  dynamicIsland: {
    name: "native-platform-exploration",
    supportedOnWeb: false,
  },
} as const;

export type TrajectoryMotion = typeof trajectoryMotion;
