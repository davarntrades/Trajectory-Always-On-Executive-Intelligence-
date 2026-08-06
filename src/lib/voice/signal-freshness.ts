/**
 * Whether a displayed Executive Signal was generated for the request the user
 * just made, or is a preserved earlier one.
 *
 * When a provider request fails, the previous signal stays on screen — losing
 * it would be worse. But presenting it unchanged implies it answers the new
 * request, which it does not. These helpers decide when to say otherwise.
 */

export type SignalFreshness = "current" | "stale";

export interface SignalPresentation {
  freshness: SignalFreshness;
  /** Eyebrow label: the product name when current, a stale marker when not. */
  label: string;
  /** True when the card should visibly mark itself as not answering this request. */
  marked: boolean;
}

export function formatSignalTime(computedAt: string): string {
  const at = new Date(computedAt);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * A signal is stale whenever the request that should have replaced it did not
 * produce one — i.e. the voice pipeline is in its failure state while a
 * previously valid signal is still displayed.
 */
export function presentSignal(input: {
  status: string;
  hasSignal: boolean;
  computedAt: string;
  currentLabel: string;
}): SignalPresentation {
  const stale = input.status === "failure" && input.hasSignal;
  if (!stale) {
    return { freshness: "current", label: input.currentLabel, marked: false };
  }
  const time = formatSignalTime(input.computedAt);
  return {
    freshness: "stale",
    label: time ? `Last valid signal · ${time}` : "Last valid signal",
    marked: true,
  };
}
