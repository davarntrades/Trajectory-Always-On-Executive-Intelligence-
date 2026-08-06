"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { trajectoryMotion } from "@/content/trajectory-motion";

function randomBetween(minimum: number, maximum: number) {
  return Math.round(minimum + Math.random() * (maximum - minimum));
}

/**
 * Reduced motion is read from the platform rather than a product setting so a
 * single accessibility preference governs every celestial primitive.
 */
const reducedMotionQuery = () =>
  typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");

function subscribeToReducedMotion(onChange: () => void) {
  const query = reducedMotionQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => reducedMotionQuery()?.matches ?? false,
    () => false,
  );
}

/**
 * Ambient motion is suspended whenever the document is hidden or the window
 * loses focus so background work never costs battery on an unattended tab.
 */
function subscribeToPageActivity(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  window.addEventListener("pagehide", onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
    window.removeEventListener("pagehide", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

export function usePageActive() {
  return useSyncExternalStore(
    subscribeToPageActivity,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

/**
 * The approved Trajectory symbol: a realistic white point of light with a soft
 * luminous trail travelling behind it. Reproduced in CSS from the brand
 * concepts in `public/brand/trajectory-concepts/`.
 */
export function TrajectoryMark({ className = "" }: { className?: string }) {
  return (
    <span className={`trajectory-mark ${className}`.trim()} aria-hidden="true">
      <span className="mark-core" />
      <span className="mark-tail" />
    </span>
  );
}

interface AmbientCrossing {
  key: number;
  top: number;
  left: number;
  length: number;
  angle: number;
  travel: number;
}

function nextCrossing(key: number): AmbientCrossing {
  const angle = randomBetween(-34, -16);
  return {
    key,
    top: randomBetween(8, 74),
    left: randomBetween(24, 88),
    length: randomBetween(58, 108),
    angle,
    travel: randomBetween(150, 260),
  };
}

/**
 * A single tiny shooting star crossing the sky on a randomised 20–40 second
 * cadence. Each crossing re-randomises its origin, length and angle so the
 * loop never becomes consciously detectable.
 */
export function AmbientShootingStar({ seedDelay = 0 }: { seedDelay?: number }) {
  const [crossing, setCrossing] = useState<AmbientCrossing | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const pageActive = usePageActive();
  const ambient = pageActive && !reducedMotion;

  useEffect(() => {
    if (!ambient) return;
    let key = 0;
    let hideTimer: number | undefined;
    let showTimer: number | undefined;
    const randomInterval = () => randomBetween(
      trajectoryMotion.shootingStars.minimumInterval,
      trajectoryMotion.shootingStars.maximumInterval,
    );

    const schedule = (delay: number) => {
      showTimer = window.setTimeout(() => {
        key += 1;
        setCrossing(nextCrossing(key));
        hideTimer = window.setTimeout(() => {
          setCrossing(null);
          schedule(randomInterval());
        }, trajectoryMotion.shootingStars.duration);
      }, delay);
    };

    schedule(seedDelay + randomInterval());

    return () => {
      if (showTimer) window.clearTimeout(showTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
      setCrossing(null);
    };
  }, [ambient, seedDelay]);

  if (!ambient || !crossing) return null;
  return (
    <span
      key={crossing.key}
      className="shooting-star shooting-star-ambient"
      aria-hidden="true"
      style={{
        top: `${crossing.top}%`,
        left: `${crossing.left}%`,
        width: `${crossing.length}px`,
        "--crossing-angle": `${crossing.angle}deg`,
        "--crossing-travel": `${crossing.travel}px`,
        "--crossing-duration": `${trajectoryMotion.shootingStars.duration}ms`,
      } as React.CSSProperties}
    />
  );
}

/**
 * The shooting star that crosses the Executive Signal plane while one
 * recommendation gives way to the next.
 */
export function SignalCrossing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      className="shooting-star signal-crossing"
      aria-hidden="true"
      style={{ "--crossing-duration": `${trajectoryMotion.executiveSignal.crossingDuration}ms` } as React.CSSProperties}
    />
  );
}

export function CelestialLoader({ label }: { label: string }) {
  return (
    <span className="celestial-loader" role="status" aria-label={label}>
      <span className="celestial-loader-star" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function ConstellationSuccess({ label }: { label: string }) {
  return (
    <span className="constellation-success" role="status" aria-label={label}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The five visual phases of the orb. `integrating` is Trajectory's word for
 * the state other products would label processing.
 */
export type OrbPhase = "idle" | "listening" | "integrating" | "speaking" | "settling";

const phaseForStatus: Record<string, OrbPhase> = {
  idle: "idle",
  failure: "idle",
  unsupported: "idle",
  listening: "listening",
  finalising: "integrating",
  submitting: "integrating",
  validating: "integrating",
  persisted: "integrating",
  rendered: "integrating",
  speaking: "speaking",
};

/**
 * Maps the voice pipeline's status vocabulary onto the orb's visual phases,
 * inserting a brief settling phase whenever an active state resolves back to
 * rest so the orb eases down rather than snapping to idle. Phase changes are
 * always driven by the live status, so an interrupted state can never leave
 * the orb visually stuck.
 */
export function useOrbPhase(status: string): OrbPhase {
  const target = phaseForStatus[status] ?? "idle";
  const [previousTarget, setPreviousTarget] = useState<OrbPhase>(target);
  const [phase, setPhase] = useState<OrbPhase>(target);

  if (previousTarget !== target) {
    setPreviousTarget(target);
    setPhase(target === "idle" && previousTarget !== "idle" ? "settling" : target);
  }

  useEffect(() => {
    if (phase !== "settling") return;
    const timer = window.setTimeout(() => setPhase("idle"), trajectoryMotion.voiceOrb.settleDuration);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return phase;
}

export type SignalTransitionStage = "settled" | "leaving" | "entering";

/**
 * Holds the rendered Executive Signal one beat behind the incoming one so a
 * new recommendation fades out, is crossed by a shooting star, then fades in.
 * The transition keys off the signal identity, so unrelated rerenders never
 * replay it. The measured body height is held across the swap so the card
 * cannot jump when the replacement recommendation is a different length.
 */
export function useSignalTransition<T extends { id: string } | null>(incoming: T) {
  const reducedMotion = usePrefersReducedMotion();
  const [displayed, setDisplayed] = useState<T>(incoming);
  const [pending, setPending] = useState<T>(incoming);
  const [trackedId, setTrackedId] = useState<string | null>(incoming?.id ?? null);
  const [stage, setStage] = useState<SignalTransitionStage>("settled");
  const [bodyElement, setBodyElement] = useState<HTMLElement | null>(null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);

  const incomingId = incoming?.id ?? null;
  if (incomingId !== trackedId) {
    setTrackedId(incomingId);
    setPending(incoming);
    setStage("leaving");
    setLockedHeight(naturalHeight);
  }

  const exitDuration = reducedMotion
    ? trajectoryMotion.reducedMotion.duration
    : trajectoryMotion.executiveSignal.exitDuration;
  const enterDuration = reducedMotion
    ? trajectoryMotion.reducedMotion.duration
    : trajectoryMotion.executiveSignal.enterDuration;

  useEffect(() => {
    if (!bodyElement || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setNaturalHeight(bodyElement.offsetHeight));
    observer.observe(bodyElement);
    return () => observer.disconnect();
  }, [bodyElement]);

  useEffect(() => {
    if (stage === "settled") return;
    if (stage === "leaving") {
      const timer = window.setTimeout(() => {
        setDisplayed(pending);
        setStage("entering");
      }, exitDuration);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setStage("settled");
      setLockedHeight(null);
    }, enterDuration);
    return () => window.clearTimeout(timer);
  }, [enterDuration, exitDuration, pending, stage]);

  return {
    displayed,
    stage,
    lockedHeight,
    bodyRef: setBodyElement,
    crossing: !reducedMotion && stage !== "settled",
  };
}
