/**
 * Display rendering for a recognised transcript.
 *
 * Speech recognition returns unpunctuated, lower-case text. Showing it raw
 * reads as broken; rewriting what gets *sent* would change the user's request.
 * So this is presentation only — `submittedTranscript` is what goes to the
 * provider, and it is returned untouched.
 */

/**
 * Tidies a final transcript for display: sentence case and a terminal mark.
 * Never reorders, substitutes or removes words.
 */
export function transcriptForDisplay(transcript: string): string {
  const trimmed = transcript.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const cased = trimmed[0].toUpperCase() + trimmed.slice(1);
  if (/[.!?…]$/.test(cased)) return cased;
  return `${cased}${/^(who|what|when|where|why|how|is|are|do|does|did|can|could|should|would|will)\b/i.test(trimmed) ? "?" : "."}`;
}

/**
 * The exact text sent to the provider. Display formatting must never reach
 * the request payload.
 */
export function submittedTranscript(transcript: string): string {
  return transcript.trim();
}
