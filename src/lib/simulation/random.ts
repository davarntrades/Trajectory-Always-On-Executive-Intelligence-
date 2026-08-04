/**
 * Deterministic randomness.
 *
 * The whole system rests on reproducibility (ARCHITECTURE.md §2), and Monte
 * Carlo threatens it. The resolution: every draw comes from a seeded PRNG whose
 * seed is derived from the snapshot, so the same substrate replays to a
 * byte-identical simulation. Stochastic does not mean unreproducible.
 *
 * Draws are also split into independent *streams* (one per dynamic process).
 * That is what makes common random numbers work: when the baseline arm and an
 * intervention arm both sample the reply stream, they consume the same draws in
 * the same order regardless of what the opportunity stream did. Differences
 * between arms are then attributable to the intervention, not to sampling noise.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough distribution for this purpose. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash so seeds can be derived from strings (e.g. snapshot ids). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = (h + 0x9e3779b9) | 0;
  }
  return h >>> 0;
}

/**
 * The named draw streams. One per stochastic process in SIMULATION.md §3, so
 * each process's draw sequence is independent of the others.
 */
export type Stream =
  | "opportunity"
  | "reply"
  | "capacity"
  | "arrival"
  | "momentum";

/**
 * A bundle of per-stream generators for a single trajectory.
 *
 * Every arm of a counterfactual comparison builds this with the same
 * `trajectory` index, which is what implements common random numbers.
 */
export class StreamSet {
  private streams = new Map<Stream, Rng>();

  constructor(
    private baseSeed: number,
    private trajectory: number,
  ) {}

  get(stream: Stream): Rng {
    let rng = this.streams.get(stream);
    if (!rng) {
      rng = makeRng(hashSeed(this.baseSeed, stream, this.trajectory));
      this.streams.set(stream, rng);
    }
    return rng;
  }
}

// --- distributions ---------------------------------------------------------

/** Did an event with per-step hazard `rate` occur this step? */
export const bernoulli = (rng: Rng, p: number): boolean => rng() < clamp01(p);

/** Box–Muller. Used for capacity, which is roughly symmetric around a mean. */
export function normal(rng: Rng, mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Number of Poisson arrivals in one step. Knuth's method; lambda here is small. */
export function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit && k < 50);
  return k - 1;
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// --- distribution summaries ------------------------------------------------

export interface Summary {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  /** Conditional value at risk: mean of the worst 10% of outcomes. */
  cvar10: number;
}

export function summarise(values: number[]): Summary {
  if (!values.length) {
    return { mean: 0, p10: 0, p50: 0, p90: 0, cvar10: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

  const tailSize = Math.max(1, Math.floor(sorted.length * 0.1));
  const tail = sorted.slice(0, tailSize);

  return {
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    p10: at(0.1),
    p50: at(0.5),
    p90: at(0.9),
    cvar10: tail.reduce((s, v) => s + v, 0) / tail.length,
  };
}
