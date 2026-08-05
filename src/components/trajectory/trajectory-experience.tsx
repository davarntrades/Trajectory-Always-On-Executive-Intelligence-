"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { selectLoadingState, trajectoryLanguage as language } from "@/content/trajectory-language";
import type { ProviderOption, ProviderPreference } from "@/lib/providers/types";
import type { RiskLevel, TrajectoryDirection } from "@/lib/types";

export interface ExperienceState {
  computedAt: string;
  trajectory: TrajectoryDirection;
  riskLevel: RiskLevel;
  meaningfulChanges: number;
  bottleneck?: string;
  action?: { title: string; why: string };
  reasoning: string;
  impact?: { change: number; horizonDays: number; withinNoise: boolean };
}

type VoiceStatus = "idle" | "integrating" | "speaking" | "listening" | "unsupported";
interface BriefResponse { speech: string; lines: string[]; provider: string; model: string | null }
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

const lightTone: Record<RiskLevel, string> = {
  low: "positive",
  elevated: "attention",
  high: "critical",
  critical: "critical",
};

const directionCopy: Record<TrajectoryDirection, string> = {
  accelerating: language.trajectory.accelerating,
  steady: language.trajectory.steady,
  slipping: language.trajectory.slipping,
  stalled: language.trajectory.stalled,
};

function expectedShift(state: ExperienceState) {
  if (!state.impact) return language.trajectory.awaitingMeasurement;
  if (state.impact.withinNoise) return language.trajectory.withinNoise;
  return language.experience.expectedShift(
    Math.round(state.impact.change * 100),
    state.impact.horizonDays,
  );
}

function concise(text: string, limit = 180) {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0]?.trim() || text.trim();
  if (firstSentence.length <= limit) return firstSentence;
  return `${firstSentence.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

export function TrajectoryExperience({ ownerName, state, providers, defaultProvider }: {
  ownerName: string;
  state: ExperienceState;
  providers: ProviderOption[];
  defaultProvider: ProviderPreference;
}) {
  const voiceSupported = useSyncExternalStore(subscribeNoop, supportsVoice, () => true);
  const [rawStatus, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [briefLines, setBriefLines] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProviderPreference>(defaultProvider);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [cycleLabel, setCycleLabel] = useState<string>(language.loadingStates.integratingObservations);
  const cycleRef = useRef(0);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const speechPulseRef = useRef<number | null>(null);
  const status = voiceSupported ? rawStatus : "unsupported";
  const active = status === "integrating" || status === "listening" || status === "speaking";

  const chooseProvider = useCallback((next: ProviderPreference) => {
    setProvider(next);
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: next }),
    }).catch(() => undefined);
  }, []);

  const resetOrbLevel = useCallback(() => {
    orbRef.current?.style.setProperty("--voice-scale", "1");
    orbRef.current?.style.setProperty("--voice-brightness", "1");
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (meterFrameRef.current !== null) window.cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
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
    setCycleLabel(selectLoadingState(cycleRef.current++));
    setStatus("integrating");
    try {
      const response = await fetch("/api/voice/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptRef.current, provider }),
      });
      if (!response.ok) throw new Error(`voice brief ${response.status}`);
      const brief = (await response.json()) as BriefResponse;
      setBriefLines(brief.lines);
      setActiveModel(brief.model);
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
      setBriefLines([language.voice.failure]);
    }
  }, [provider, resetOrbLevel]);

  const stop = useCallback(() => {
    transcriptRef.current = "";
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
    stopAudioMeter();
    setStatus("idle");
  }, [stopAudioMeter]);

  useEffect(() => () => stop(), [stop]);

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
      if (transcriptRef.current.trim()) void deliverBrief();
      else setStatus("idle");
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
  const trajectoryLogic = state.reasoning || action?.why || language.trajectory.preserveLeverage;
  const statusLabel = status === "idle" ? language.status.observingQuietly
    : status === "integrating" ? cycleLabel
      : status === "speaking" ? language.status.speaking
        : status === "listening" ? language.status.listening
          : language.status.voiceUnavailable;

  return (
    <main className={`trajectory-experience light-${lightTone[state.riskLevel]} status-${status}`}>
      <div className="star-field" aria-hidden="true">
        <div className="stars stars-near" /><div className="stars stars-far" />
        <div className="milky-way" /><div className="cosmic-dust" /><div className="nebula" />
        <div className="distant-galaxy galaxy-one" /><div className="distant-galaxy galaxy-two" />
        <div className="shooting-star shooting-star-one" /><div className="shooting-star shooting-star-two" />
      </div>
      <div className="edge-light" aria-hidden="true" />

      <header className="experience-header">
        <a className="wordmark" href="#intelligence" aria-label={language.brand.homeLabel}>
          <span className="trajectory-mark" aria-hidden="true"><span className="mark-core" /><span className="mark-tail" /></span>
          <span>{language.brand.name}</span><sup>©</sup>
        </a>
        <div className="header-controls">
          <label className="provider-setting">
            <span className="sr-only">{language.brand.providerLabel}</span>
            <select value={provider} onChange={(event) => chooseProvider(event.target.value as ProviderPreference)} aria-label={language.brand.providerLabel}>
              <option value="auto">{language.brand.automaticProvider}</option>
              {providers.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.configured}>
                  {option.label}{option.configured ? "" : language.brand.unavailableSuffix}
                </option>
              ))}
            </select>
          </label>
          <div className="presence"><span className="presence-dot" /><span>{statusLabel}</span></div>
        </div>
      </header>

      <section className="intelligence-stage" id="intelligence" aria-label={language.brand.intelligenceRegion}>
        <button ref={orbRef} type="button" className={`orb-system is-${status}`} onClick={active ? stop : listen}
          disabled={status === "unsupported"} aria-label={active ? language.voice.stopInteraction : language.voice.speakToTrajectory}>
          <div className="watch-stream stream-one" /><div className="watch-stream stream-two" />
          <div className="orb-halo halo-one" /><div className="orb-halo halo-two" />
          <div className="speech-wave speech-wave-one" /><div className="speech-wave speech-wave-two" />
          <div className="orb-ring ring-one"><span /></div><div className="orb-ring ring-two"><span /></div>
          <div className="trajectory-orb"><div className="orb-atmosphere" /><div className="orb-energy" /><div className="orb-glass" /><div className="orb-reflection" /></div>
        </button>
        <div className="orb-copy" aria-live="polite">
          <p className="orb-kicker">{language.brand.descriptor}</p>
          <h1>{status === "listening" ? language.voice.listening : language.experience.greeting(ownerName)}</h1>
          {status === "idle" || status === "unsupported" ? (
            <div className="wake-dialogue"><p>{language.experience.meaningfulChanges(state.meaningfulChanges)}</p><p>{language.trajectory.leverageReady}</p></div>
          ) : <p className="live-voice-copy">{transcript || statusLabel}</p>}
        </div>
        <p className="interaction-hint">{status === "unsupported" ? language.voice.unavailableInBrowser : active ? language.voice.tapToStop : language.voice.tapToSpeak}</p>
      </section>

      <section className="briefing-card" aria-labelledby="briefing-title">
        <div className="card-eyebrow"><span><Sparkles size={13} /> {language.headings.executiveSignal}</span>
          <time dateTime={state.computedAt}>{new Date(state.computedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        <div className="briefing-primary"><p>{language.headings.highestLeverageAction}</p><h2 id="briefing-title">{action?.title ?? language.trajectory.continueObserving}</h2></div>
        <div className="briefing-details">
          <div><span>{language.headings.currentState}</span><p>{directionCopy[state.trajectory]}</p></div>
          <div><span>{language.headings.currentDynamics}</span><p>{state.bottleneck ? language.experience.currentConstraint(state.bottleneck) : language.trajectory.noConstraint}</p></div>
          <div><span>{language.headings.expectedShift}</span><p>{expectedShift(state)}</p></div>
          <div><span>{language.headings.trajectoryLogic}</span><p>{concise(trajectoryLogic)}</p></div>
        </div>
        {briefLines.length > 0 ? <div className="briefing-response" aria-live="polite">{briefLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div> : null}
        {activeModel ? <p className="model-footnote">{activeModel}</p> : null}
      </section>
    </main>
  );
}
