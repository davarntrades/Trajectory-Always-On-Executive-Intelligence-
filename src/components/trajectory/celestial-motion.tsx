"use client";

import { useEffect, useMemo, useState } from "react";
import { trajectoryMotion } from "@/content/trajectory-motion";

function randomBetween(minimum: number, maximum: number) {
  return Math.round(minimum + Math.random() * (maximum - minimum));
}

export function TrajectoryMark({ className = "" }: { className?: string }) {
  return (
    <span className={`trajectory-mark ${className}`.trim()} aria-hidden="true">
      <span className="mark-core" />
      <span className="mark-tail" />
    </span>
  );
}

export function AmbientShootingStar() {
  const [visible, setVisible] = useState(false);
  const interval = useMemo(
    () => randomBetween(
      trajectoryMotion.shootingStars.minimumInterval,
      trajectoryMotion.shootingStars.maximumInterval,
    ),
    [],
  );

  useEffect(() => {
    let hideTimer: number | undefined;
    const showTimer = window.setTimeout(() => {
      setVisible(true);
      hideTimer = window.setTimeout(
        () => setVisible(false),
        trajectoryMotion.shootingStars.duration,
      );
    }, interval);

    return () => {
      window.clearTimeout(showTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [interval]);

  return (
    <span
      className={`shooting-star shooting-star-ambient${visible ? " is-visible" : ""}`}
      aria-hidden="true"
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
