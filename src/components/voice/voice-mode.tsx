"use client";

/**
 * Voice mode — Phase 1 scaffold.
 *
 * What is real here: the briefing is generated from the same computed state the
 * dashboard renders, speech synthesis speaks it, microphone input is captured,
 * and barge-in works — speaking over Trajectory cuts it off mid-sentence, which
 * is the interaction that makes voice feel like a conversation rather than a
 * playback button.
 *
 * What Phase 4 replaces: browser SpeechSynthesis and SpeechRecognition are
 * stand-ins. Real-time natural voice needs a streaming speech provider with
 * sub-second turn latency. The component boundary is drawn so that swap touches
 * this file only — the briefing, state, and memory layers are unaffected.
 */

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/panel";

type Status = "idle" | "loading" | "speaking" | "listening" | "unsupported";

interface BriefResponse {
  speech: string;
  lines: string[];
}

// Minimal structural types — the Web Speech API is not in the DOM lib.
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Speech-synthesis support is a platform value, not React state — read it via
 * useSyncExternalStore so it is correct on the client without an effect that
 * would trigger a cascading render. The server snapshot assumes support so the
 * button renders enabled during SSR and corrects on hydration if it is absent.
 */
const subscribeNoop = () => () => {};
const supportsSpeech = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

export function VoiceMode() {
  const supported = useSyncExternalStore(subscribeNoop, supportsSpeech, () => true);

  const [rawStatus, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [heard, setHeard] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const status: Status = supported ? rawStatus : "unsupported";

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /** Barge-in: any recognised speech cancels playback immediately. */
  const startListening = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-GB";

    recognition.onresult = (event) => {
      // The moment there is any transcript, Trajectory stops talking.
      stopSpeaking();
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript ?? "";
      setHeard(transcript);
      setStatus("listening");
    };
    recognition.onend = () => setStatus("idle");
    recognition.onerror = () => setStatus("idle");

    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
  }, [stopSpeaking]);

  const speak = useCallback(
    (text: string) => {
      if (!("speechSynthesis" in window)) return;
      stopSpeaking();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1;
      utterance.lang = "en-GB";
      utterance.onend = () => setStatus("idle");
      setStatus("speaking");
      window.speechSynthesis.speak(utterance);
    },
    [stopSpeaking],
  );

  const brief = useCallback(async () => {
    setStatus("loading");
    setHeard("");
    try {
      const res = await fetch("/api/voice/brief");
      if (!res.ok) throw new Error(`brief failed: ${res.status}`);
      const data = (await res.json()) as BriefResponse;
      setLines(data.lines);
      speak(data.speech);
      // Listen while speaking, so barge-in is possible from the first word.
      startListening();
    } catch {
      setStatus("idle");
      setLines(["Could not generate the briefing."]);
    }
  }, [speak, startListening]);

  const stop = useCallback(() => {
    stopSpeaking();
    recognitionRef.current?.stop();
    setStatus("idle");
  }, [stopSpeaking]);

  const busy = status === "speaking" || status === "listening" || status === "loading";

  return (
    <div className="rounded-xl border border-border bg-surface/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Voice
          </h2>
          <p className="mt-0.5 text-xs text-faint">
            Proactive brief · interrupt any time
          </p>
        </div>
        <Badge
          tone={
            status === "speaking"
              ? "accent"
              : status === "listening"
                ? "positive"
                : status === "unsupported"
                  ? "negative"
                  : "neutral"
          }
        >
          {status}
        </Badge>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={brief}
          disabled={status === "unsupported" || status === "loading"}
          className="flex-1 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
        >
          {status === "loading" ? "Preparing…" : "Brief me"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!busy}
          className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40"
        >
          Stop
        </button>
      </div>

      {heard ? (
        <p className="mt-3 rounded-md border border-positive/30 bg-positive/5 px-3 py-2 text-xs text-muted">
          <span className="text-positive">Heard:</span> {heard}
        </p>
      ) : null}

      {lines.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          {lines.map((line, i) => (
            <li key={i} className="text-xs leading-relaxed text-muted">
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Reads the same state as the dashboard, so the two can never disagree.
        </p>
      )}

      {status === "unsupported" ? (
        <p className="mt-2 text-[11px] text-negative">
          This browser has no speech synthesis. The briefing text still renders.
        </p>
      ) : null}
    </div>
  );
}
