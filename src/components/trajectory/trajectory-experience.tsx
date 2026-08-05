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

type VoiceStatus = "idle" | "integrating" | "speaking" | "listening" | "failure" | "unsupported";
interface ExecutiveSignalResponse {
  computedAt: string;
  highestLeverageRecommendation: string;
  currentObservation: string;
  reasoning: string;
  expectedImpact: string;
  confidence: number;
  currentConstraint: string;
  suggestedNextAction: string;
  urgency: number;
  trajectory: TrajectoryDirection;
  riskLevel: RiskLevel;
}
interface BriefResponse { requestId: string; speech: string; lines: string[]; signal: ExecutiveSignalResponse }
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}

const subscribeNoop = () => () => {};
const supportsVoice = () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const browser = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition);
};
const lightTone: Record<RiskLevel, string> = { low: "positive", elevated: "attention", high: "critical", critical: "critical" };
const directionCopy: Record<TrajectoryDirection, string> = {
  accelerating: language.trajectory.accelerating,
  steady: language.trajectory.steady,
  slipping: language.trajectory.slipping,
  stalled: language.trajectory.stalled,
};

function expectedShift(state: ExperienceState) {
  if (!state.impact) return language.trajectory.awaitingMeasurement;
  if (state.impact.withinNoise) return language.trajectory.withinNoise;
  return language.experience.expectedShift(Math.round(state.impact.change * 100), state.impact.horizonDays);
}
function concise(text: string, limit = 220) {
  const value = text.trim();
  return value.length <= limit ? value : `${value.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}
function isSignal(value: unknown): value is ExecutiveSignalResponse {
  if (!value || typeof value !== "object") return false;
  const signal = value as Record<string, unknown>;
  const strings = ["computedAt", "highestLeverageRecommendation", "currentObservation", "reasoning", "expectedImpact", "currentConstraint", "suggestedNextAction"];
  return strings.every((key) => typeof signal[key] === "string" && Boolean((signal[key] as string).trim()))
    && typeof signal.confidence === "number" && signal.confidence >= 0 && signal.confidence <= 1
    && typeof signal.urgency === "number" && signal.urgency >= 0 && signal.urgency <= 1
    && ["accelerating", "steady", "slipping", "stalled"].includes(String(signal.trajectory))
    && ["low", "elevated", "high", "critical"].includes(String(signal.riskLevel));
}

export function TrajectoryExperience({ ownerName, state, providers, defaultProvider }: {
  ownerName: string; state: ExperienceState; providers: ProviderOption[]; defaultProvider: ProviderPreference;
}) {
  const voiceSupported = useSyncExternalStore(subscribeNoop, supportsVoice, () => true);
  const [rawStatus, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [provider, setProvider] = useState<ProviderPreference>(defaultProvider);
  const [cycleLabel, setCycleLabel] = useState<string>(language.loadingStates.integratingObservations);
  const [signal, setSignal] = useState<ExecutiveSignalResponse | null>(null);
  const [recoverableError, setRecoverableError] = useState<string | null>(null);
  const cycleRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const lastRequestIdRef = useRef<string | null>(null);
  const spokenRequestIdRef = useRef<string | null>(null);
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
    void fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: next }) }).catch(() => undefined);
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
      if (!recognitionRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.82;
      context.createMediaStreamSource(stream).connect(analyser);
      const levels = new Uint8Array(analyser.frequencyBinCount);
      audioStreamRef.current = stream; audioContextRef.current = context;
      const sample = () => {
        analyser.getByteFrequencyData(levels);
        const level = Math.min(1, (levels.reduce((sum, item) => sum + item, 0) / levels.length) / 92);
        orbRef.current?.style.setProperty("--voice-scale", (1.035 + level * 0.09).toFixed(3));
        orbRef.current?.style.setProperty("--voice-brightness", (1.05 + level * 0.42).toFixed(3));
        meterFrameRef.current = window.requestAnimationFrame(sample);
      };
      sample();
    } catch { resetOrbLevel(); }
  }, [resetOrbLevel]);

  const speakOnce = useCallback((requestId: string, text: string) => {
    if (spokenRequestIdRef.current === requestId || !("speechSynthesis" in window)) { setStatus("idle"); return; }
    spokenRequestIdRef.current = requestId;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB"; utterance.rate = 1.01; utterance.pitch = 0.96;
    utterance.onstart = () => setStatus("speaking");
    utterance.onboundary = () => {
      if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
      orbRef.current?.style.setProperty("--voice-scale", "1.065");
      orbRef.current?.style.setProperty("--voice-brightness", "1.35");
      speechPulseRef.current = window.setTimeout(resetOrbLevel, 130);
    };
    utterance.onend = () => { resetOrbLevel(); setStatus("idle"); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [resetOrbLevel]);

  const deliverBrief = useCallback(async () => {
    const spokenPrompt = transcriptRef.current.trim();
    if (!spokenPrompt || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    const requestId = crypto.randomUUID();
    lastRequestIdRef.current = requestId;
    setCycleLabel(selectLoadingState(cycleRef.current++));
    setRecoverableError(null);
    setStatus("integrating");
    try {
      const response = await fetch("/api/voice/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: spokenPrompt, provider, requestId }),
      });
      const body = await response.json() as Partial<BriefResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error || language.voice.failure);
      if (body.requestId !== requestId || !isSignal(body.signal) || typeof body.speech !== "string" || !body.speech.trim()) {
        throw new Error(language.voice.failure);
      }
      if (lastRequestIdRef.current !== requestId) return;
      setSignal(body.signal);
      setTranscript("");
      transcriptRef.current = "";
      window.requestAnimationFrame(() => speakOnce(requestId, body.speech as string));
    } catch (error) {
      resetOrbLevel();
      setRecoverableError(error instanceof Error ? error.message : language.voice.failure);
      setStatus("failure");
    } finally {
      requestInFlightRef.current = false;
    }
  }, [provider, resetOrbLevel, speakOnce]);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop(); recognitionRef.current = null;
    if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
    stopAudioMeter();
    if (status !== "failure") setStatus("idle");
  }, [status, stopAudioMeter]);
  useEffect(() => () => stop(), [stop]);

  const listen = useCallback(() => {
    if (requestInFlightRef.current) return;
    const browser = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) { setStatus("unsupported"); return; }
    setRecoverableError(null);
    const recognition = new Recognition();
    recognition.continuous = false; recognition.interimResults = true; recognition.lang = "en-GB";
    transcriptRef.current = ""; setTranscript("");
    recognition.onresult = (event) => {
      window.speechSynthesis.cancel();
      const latest = event.results[event.results.length - 1];
      const heard = latest?.[0]?.transcript ?? "";
      transcriptRef.current = heard; setTranscript(heard); setStatus("listening");
    };
    recognition.onend = () => {
      recognitionRef.current = null; stopAudioMeter();
      if (transcriptRef.current.trim()) void deliverBrief(); else setStatus("idle");
    };
    recognition.onerror = () => { recognitionRef.current = null; stopAudioMeter(); setRecoverableError(language.voice.failure); setStatus("failure"); };
    recognitionRef.current = recognition;
    recognition.start(); void startAudioMeter(); setStatus("listening");
  }, [deliverBrief, startAudioMeter, stopAudioMeter]);

  const displayedAction = signal?.highestLeverageRecommendation ?? state.action?.title ?? language.trajectory.continueObserving;
  const displayedState = signal?.currentObservation ?? directionCopy[state.trajectory];
  const displayedConstraint = signal?.currentConstraint ?? (state.bottleneck ? language.experience.currentConstraint(state.bottleneck) : language.trajectory.noConstraint);
  const displayedImpact = signal?.expectedImpact ?? expectedShift(state);
  const displayedReasoning = signal?.reasoning ?? state.reasoning ?? state.action?.why ?? language.trajectory.preserveLeverage;
  const displayedTime = signal?.computedAt ?? state.computedAt;
  const displayedRisk = signal?.riskLevel ?? state.riskLevel;
  const statusLabel = status === "idle" ? language.status.observingQuietly
    : status === "integrating" ? cycleLabel
      : status === "speaking" ? language.status.speaking
        : status === "listening" ? language.status.listening
          : status === "failure" ? language.voice.failure
            : language.status.voiceUnavailable;

  return (
    <main className={`trajectory-experience light-${lightTone[displayedRisk]} status-${status}`}>
      <div className="star-field" aria-hidden="true"><div className="stars stars-near" /><div className="stars stars-far" /><div className="milky-way" /><div className="cosmic-dust" /><div className="nebula" /><div className="distant-galaxy galaxy-one" /><div className="distant-galaxy galaxy-two" /><div className="shooting-star shooting-star-one" /><div className="shooting-star shooting-star-two" /></div>
      <div className="edge-light" aria-hidden="true" />
      <header className="experience-header">
        <a className="wordmark" href="#intelligence" aria-label={language.brand.homeLabel}><span className="trajectory-mark" aria-hidden="true"><span className="mark-core" /><span className="mark-tail" /></span><span>{language.brand.name}</span><sup>©</sup></a>
        <div className="header-controls"><label className="provider-setting"><span className="sr-only">{language.brand.providerLabel}</span><select value={provider} onChange={(event) => chooseProvider(event.target.value as ProviderPreference)} aria-label={language.brand.providerLabel}><option value="auto">{language.brand.automaticProvider}</option>{providers.map((option) => <option key={option.id} value={option.id} disabled={!option.configured}>{option.label}{option.configured ? "" : language.brand.unavailableSuffix}</option>)}</select></label><div className="presence"><span className="presence-dot" /><span>{statusLabel}</span></div></div>
      </header>
      <section className="intelligence-stage" id="intelligence" aria-label={language.brand.intelligenceRegion}>
        <button ref={orbRef} type="button" className={`orb-system is-${status}`} onClick={active ? stop : listen} disabled={status === "unsupported"} aria-label={active ? language.voice.stopInteraction : language.voice.speakToTrajectory}>
          <div className="watch-stream stream-one" /><div className="watch-stream stream-two" /><div className="orb-halo halo-one" /><div className="orb-halo halo-two" /><div className="speech-wave speech-wave-one" /><div className="speech-wave speech-wave-two" /><div className="orb-ring ring-one"><span /></div><div className="orb-ring ring-two"><span /></div><div className="trajectory-orb"><div className="orb-atmosphere" /><div className="orb-energy" /><div className="orb-glass" /><div className="orb-reflection" /></div>
        </button>
        <div className="orb-copy" aria-live="polite"><p className="orb-kicker">{language.brand.descriptor}</p><h1>{status === "listening" ? language.voice.listening : language.experience.greeting(ownerName)}</h1>{status === "idle" || status === "unsupported" || status === "failure" ? <div className="wake-dialogue"><p>{language.experience.meaningfulChanges(state.meaningfulChanges)}</p><p>{language.trajectory.leverageReady}</p></div> : <p className="live-voice-copy">{transcript || statusLabel}</p>}</div>
        <p className="interaction-hint">{status === "unsupported" ? language.voice.unavailableInBrowser : active ? language.voice.tapToStop : language.voice.tapToSpeak}</p>
        {recoverableError ? <button type="button" className="voice-error" onClick={() => { setRecoverableError(null); setStatus("idle"); }}>{recoverableError} · Try again</button> : null}
      </section>
      <section className={`briefing-card${signal ? " signal-updated" : ""}`} aria-labelledby="briefing-title" aria-live="polite">
        <div className="card-eyebrow"><span><Sparkles size={13} /> {language.headings.executiveSignal}</span><time dateTime={displayedTime}>{new Date(displayedTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time></div>
        <div className="briefing-primary"><p>{language.headings.highestLeverageAction}</p><h2 id="briefing-title">{displayedAction}</h2></div>
        <div className="briefing-details">
          <div><span>{language.headings.currentState}</span><p>{displayedState}</p></div>
          <div><span>{language.headings.currentDynamics}</span><p>{displayedConstraint}</p></div>
          <div><span>{language.headings.expectedShift}</span><p>{displayedImpact}</p></div>
          <div><span>{language.headings.trajectoryLogic}</span><p>{concise(displayedReasoning)}</p></div>
          {signal ? <><div><span>Confidence</span><p>{Math.round(signal.confidence * 100)}%</p></div><div><span>Urgency</span><p>{Math.round(signal.urgency * 100)}%</p></div><div><span>Suggested next action</span><p>{signal.suggestedNextAction}</p></div></> : null}
        </div>
      </section>
    </main>
  );
}
