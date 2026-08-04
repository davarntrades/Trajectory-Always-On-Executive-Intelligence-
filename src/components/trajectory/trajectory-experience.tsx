"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import type { RiskLevel, TrajectoryDirection } from "@/lib/types";

export interface ExperienceState {
  computedAt: string;
  trajectory: TrajectoryDirection;
  riskLevel: RiskLevel;
  meaningfulChanges: number;
  bottleneck?: string;
  action?: { title: string; why: string };
  reasoning: string;
  impact?: {
    change: number;
    horizonDays: number;
    withinNoise: boolean;
  };
}

type VoiceStatus = "idle" | "thinking" | "speaking" | "listening" | "unsupported";

interface BriefResponse {
  speech: string;
  lines: string[];
}

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

const subscribeNoop = () => () => {};
const supportsVoice = () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const browser = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition);
};

const directionCopy: Record<TrajectoryDirection, string> = {
  accelerating: "Your trajectory is strengthening.",
  steady: "Your trajectory is holding steady.",
  slipping: "Momentum is beginning to soften.",
  stalled: "Your trajectory needs a deliberate reset.",
};

const lightTone: Record<RiskLevel, string> = {
  low: "positive",
  elevated: "attention",
  high: "critical",
  critical: "critical",
};

function formatImpact(state: ExperienceState) {
  const outlook = state.impact;
  if (!outlook) return "Trajectory impact will be measured after the next state update.";

  const change = Math.round(outlook.change * 100);
  if (outlook.withinNoise) {
    return "The expected change is currently within the model’s noise floor.";
  }

  return `${change >= 0 ? "+" : ""}${change}% expected trajectory change over the next ${outlook.horizonDays} days.`;
}

function concise(text: string, limit = 150) {
  const firstThought = text.split(/(?<=[.!?])\s/)[0]?.trim() || text.trim();
  if (firstThought.length <= limit) return firstThought;
  return `${firstThought.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

export function TrajectoryExperience({
  ownerName,
  state,
}: {
  ownerName: string;
  state: ExperienceState;
}) {
  const voiceSupported = useSyncExternalStore(subscribeNoop, supportsVoice, () => true);
  const [rawStatus, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [briefLines, setBriefLines] = useState<string[]>([]);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const speechPulseRef = useRef<number | null>(null);
  const status = voiceSupported ? rawStatus : "unsupported";
  const active = status === "thinking" || status === "listening" || status === "speaking";

  const resetOrbLevel = useCallback(() => {
    orbRef.current?.style.setProperty("--voice-scale", "1");
    orbRef.current?.style.setProperty("--voice-brightness", "1");
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    resetOrbLevel();
  }, [resetOrbLevel]);

  const startAudioMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recognitionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      context.createMediaStreamSource(stream).connect(analyser);
      const levels = new Uint8Array(analyser.frequencyBinCount);
      audioStreamRef.current = stream;
      audioContextRef.current = context;

      const sample = () => {
        analyser.getByteFrequencyData(levels);
        const average = levels.reduce((sum, level) => sum + level, 0) / levels.length;
        const level = Math.min(1, average / 92);
        orbRef.current?.style.setProperty("--voice-scale", (1.035 + level * 0.09).toFixed(3));
        orbRef.current?.style.setProperty("--voice-brightness", (1.05 + level * 0.42).toFixed(3));
        meterFrameRef.current = window.requestAnimationFrame(sample);
      };
      sample();
    } catch {
      resetOrbLevel();
    }
  }, [resetOrbLevel]);

  const deliverBrief = useCallback(async () => {
    setStatus("thinking");
    try {
      const response = await fetch("/api/voice/brief");
      if (!response.ok) throw new Error(`Briefing failed: ${response.status}`);
      const brief = (await response.json()) as BriefResponse;
      setBriefLines(brief.lines);

      const utterance = new SpeechSynthesisUtterance(brief.speech);
      utterance.lang = "en-GB";
      utterance.rate = 1.01;
      utterance.pitch = 0.96;
      utterance.onstart = () => setStatus("speaking");
      utterance.onboundary = () => {
        if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
        orbRef.current?.style.setProperty("--voice-scale", "1.065");
        orbRef.current?.style.setProperty("--voice-brightness", "1.35");
        speechPulseRef.current = window.setTimeout(resetOrbLevel, 130);
      };
      utterance.onend = () => {
        resetOrbLevel();
        setStatus("idle");
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      resetOrbLevel();
      setStatus("idle");
      setBriefLines(["Trajectory could not prepare the briefing. Please try again."]);
    }
  }, [resetOrbLevel]);

  const stop = useCallback(() => {
    transcriptRef.current = "";
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
    stopAudioMeter();
    setStatus("idle");
  }, [stopAudioMeter]);

  useEffect(() => () => {
    transcriptRef.current = "";
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
    stopAudioMeter();
  }, [stopAudioMeter]);

  const listen = useCallback(() => {
    const browser = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;

    if (!Recognition) {
      setStatus("unsupported");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-GB";
    transcriptRef.current = "";
    recognition.onresult = (event) => {
      window.speechSynthesis.cancel();
      const latest = event.results[event.results.length - 1];
      const heard = latest?.[0]?.transcript ?? "";
      transcriptRef.current = heard;
      setTranscript(heard);
      setStatus("listening");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      stopAudioMeter();
      if (transcriptRef.current.trim()) {
        void deliverBrief();
      } else {
        setStatus("idle");
      }
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      stopAudioMeter();
      setStatus("idle");
    };
    recognitionRef.current = recognition;
    recognition.start();
    void startAudioMeter();
    setStatus("listening");
  }, [deliverBrief, startAudioMeter, stopAudioMeter]);

  const action = state.action;
  const reasoning = state.reasoning || action?.why ||
    "Trajectory is observing the current signals and preserving the highest-leverage path.";
  const statusLabel = status === "idle" ? "Observing quietly" :
    status === "thinking" ? "A higher-leverage path is emerging" :
    status === "speaking" ? "Trajectory is speaking" :
    status === "listening" ? "Listening" : "Voice unavailable";

  return (
    <main className={`trajectory-experience light-${lightTone[state.riskLevel]} status-${status}`}>
      <div className="star-field" aria-hidden="true">
        <div className="stars stars-near" />
        <div className="stars stars-far" />
        <div className="milky-way" />
        <div className="cosmic-dust" />
        <div className="nebula" />
        <div className="distant-galaxy galaxy-one" />
        <div className="distant-galaxy galaxy-two" />
        <div className="shooting-star shooting-star-one" />
        <div className="shooting-star shooting-star-two" />
      </div>

      <div className="edge-light" aria-hidden="true" />

      <header className="experience-header">
        <a className="wordmark" href="#intelligence" aria-label="Trajectory home">
          <span className="trajectory-mark" aria-hidden="true">
            <span className="mark-core" />
            <span className="mark-tail" />
          </span>
          <span>Trajectory</span>
          <sup>©</sup>
        </a>

        <div className="presence">
          <span className="presence-dot" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <section className="intelligence-stage" id="intelligence" aria-label="Trajectory intelligence">
        <button
          ref={orbRef}
          type="button"
          className={`orb-system is-${status}`}
          onClick={active ? stop : listen}
          disabled={status === "unsupported"}
          aria-label={active ? "Stop voice interaction" : "Speak to Trajectory"}
        >
          <div className="watch-stream stream-one" />
          <div className="watch-stream stream-two" />
          <div className="orb-halo halo-one" />
          <div className="orb-halo halo-two" />
          <div className="speech-wave speech-wave-one" />
          <div className="speech-wave speech-wave-two" />
          <div className="orb-ring ring-one"><span /></div>
          <div className="orb-ring ring-two"><span /></div>
          <div className="trajectory-orb">
            <div className="orb-atmosphere" />
            <div className="orb-energy" />
            <div className="orb-glass" />
            <div className="orb-reflection" />
          </div>
        </button>

        <div className="orb-copy" aria-live="polite">
          <p className="orb-kicker">Persistent executive intelligence</p>
          <h1>{status === "listening" ? "I’m listening." : `Good evening, ${ownerName}.`}</h1>
          {status === "idle" || status === "unsupported" ? (
            <div className="wake-dialogue">
              <p>I’ve observed {state.meaningfulChanges} meaningful {state.meaningfulChanges === 1 ? "change" : "changes"} while you were away.</p>
              <p>The highest-leverage action is ready.</p>
            </div>
          ) : (
            <p className="live-voice-copy">
              {transcript || (status === "thinking" ? "Understanding what matters." : statusLabel)}
            </p>
          )}
        </div>
        <p className="interaction-hint">
          {status === "unsupported" ? "Voice unavailable in this browser" : active ? "Tap the orb to stop" : "Tap the orb to speak"}
        </p>
      </section>

      <section className="briefing-card" aria-labelledby="briefing-title">
        <div className="card-eyebrow">
          <span><Sparkles size={13} /> Executive signal</span>
          <time dateTime={state.computedAt}>
            {new Date(state.computedAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>

        <div className="briefing-primary">
          <p>Highest-leverage recommendation</p>
          <h2 id="briefing-title">{action?.title ?? "Continue observing your trajectory"}</h2>
        </div>

        <div className="briefing-details">
          <div>
            <span>Current observation</span>
            <p>{directionCopy[state.trajectory]} {state.bottleneck ? `The current constraint is ${state.bottleneck.toLowerCase()}.` : "No material constraint is blocking movement."}</p>
          </div>
          <div>
            <span>Reasoning</span>
            <p>{concise(briefLines[0] ?? reasoning)}</p>
          </div>
          <div>
            <span>Expected impact</span>
            <p>{formatImpact(state)}</p>
          </div>
        </div>
      </section>

      <footer className="experience-footer">
        <span>Live alongside your future.</span>
        <span>State updated {new Date(state.computedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
      </footer>
    </main>
  );
}
