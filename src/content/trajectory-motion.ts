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
    duration: 1800,
    stagger: 140,
  },
  starfield: {
    name: "ambient-starfield",
    driftDuration: 18000,
    opacityRange: [0.28, 0.62],
  },
  shootingStars: {
    name: "directional-crossing",
    duration: 1400,
    minimumInterval: 7000,
    maximumInterval: 16000,
  },
  voiceOrb: {
    name: "atmospheric-presence",
    idleDuration: 5200,
    listeningDuration: 2200,
    speakingDuration: 1500,
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
  success: {
    name: "directional-confirmation",
    duration: 620,
    scale: 1.015,
  },
  dynamicIsland: {
    name: "compact-trajectory-presence",
    duration: 440,
  },
} as const;

export type TrajectoryMotion = typeof trajectoryMotion;
