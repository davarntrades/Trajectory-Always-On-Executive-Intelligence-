"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { selectLoadingState, trajectoryLanguage as language } from "@/content/trajectory-language";
import {
  AmbientShootingStar,
  SignalCrossing,
  TrajectoryMark,
  useOrbPhase,
  usePageActive,
  usePrefersReducedMotion,
  useSignalTransition,
} from "@/components/trajectory/celestial-motion";
import { presentSignal } from "@/lib/voice/signal-freshness";
import { submittedTranscript, transcriptForDisplay } from "@/lib/voice/transcript";
import type { ProviderOption, ProviderPreference } from "@/lib/providers/types";
import type { ExecutiveSignalResponse } from "@/lib/executive-signals";
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

type VoiceStatus = "idle" | "listening" | "finalising" | "submitting" | "validating" | "persisted" | "rendered" | "speaking" | "failure" | "unsupported";
interface BriefResponse { requestId: string; speech: string; signal: ExecutiveSignalResponse; diagnostics?: { provider: string; persisted: boolean } }
interface RecognitionAlternative { transcript: string }
interface RecognitionResult extends ArrayLike<RecognitionAlternative> { isFinal?: boolean }
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort?(): void;
  onresult: ((event: { results: ArrayLike<RecognitionResult>; resultIndex?: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
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
const diagnostic = (event: string, detail: Record<string, unknown> = {}) => console.info("[trajectory:voice]", { event, at: new Date().toISOString(), ...detail });
function expectedShift(state: ExperienceState) {
  if (!state.impact) return language.trajectory.awaitingMeasurement;
  if (state.impact.withinNoise) return language.trajectory.withinNoise;
  return language.experience.expectedShift(Math.round(state.impact.change * 100), state.impact.horizonDays);
}
function isSignal(value: unknown): value is ExecutiveSignalResponse {
  if (!value || typeof value !== "object") return false;
  const signal = value as Record<string, unknown>;
  const strings = ["id", "computedAt", "highestLeverageRecommendation", "currentObservation", "reasoning", "expectedImpact", "currentConstraint", "suggestedNextAction"];
  return strings.every((key) => typeof signal[key] === "string" && Boolean((signal[key] as string).trim()))
    && typeof signal.confidence === "number" && signal.confidence >= 0 && signal.confidence <= 1
    && typeof signal.urgency === "number" && signal.urgency >= 0 && signal.urgency <= 1
    && ["accelerating", "steady", "slipping", "stalled"].includes(String(signal.trajectory))
    && ["low", "elevated", "high", "critical"].includes(String(signal.riskLevel));
}

export function TrajectoryExperience({ ownerName, state, providers, defaultProvider, initialSignal = null }: {
  ownerName: string;
  state: ExperienceState;
  providers: ProviderOption[];
  defaultProvider: ProviderPreference;
  initialSignal?: ExecutiveSignalResponse | null;
}) {
  const voiceSupported = useSyncExternalStore(subscribeNoop, supportsVoice, () => true);
  const [rawStatus, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [provider, setProvider] = useState<ProviderPreference>(defaultProvider);
  const [cycleLabel, setCycleLabel] = useState<string>(language.loadingStates.integratingObservations);
  const [signal, setSignal] = useState<ExecutiveSignalResponse | null>(initialSignal);
  const [recoverableError, setRecoverableError] = useState<string | null>(null);

  const cycleRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const submittedTranscriptRef = useRef<string | null>(null);
  const lastRequestIdRef = useRef<string | null>(null);
  const spokenRequestIdRef = useRef<string | null>(null);
  const speechUnlockedRef = useRef(false);
  const speechStartTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const finalTranscriptRef = useRef("");
  const stopRequestedRef = useRef(false);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const speechPulseRef = useRef<number | null>(null);

  const status = voiceSupported ? rawStatus : "unsupported";
  const active = !["idle", "failure", "unsupported"].includes(status);
  const orbPhase = useOrbPhase(status);
  const reducedMotion = usePrefersReducedMotion();
  const pageActive = usePageActive();
  const { displayed: displayedSignal, stage: signalStage, lockedHeight, bodyRef, crossing } = useSignalTransition(signal);
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
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      context.createMediaStreamSource(stream).connect(analyser);
      const levels = new Uint8Array(analyser.frequencyBinCount);
      audioStreamRef.current = stream;
      audioContextRef.current = context;
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

  const unlockSpeech = useCallback(() => {
    if (!("speechSynthesis" in window) || speechUnlockedRef.current) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.getVoices();
    const primer = new SpeechSynthesisUtterance("\u200B");
    primer.lang = "en-GB";
    primer.volume = 0.01;
    primer.rate = 10;
    primer.onstart = () => { speechUnlockedRef.current = true; diagnostic("speech_unlocked", { method: "gesture_primer" }); };
    primer.onend = () => { speechUnlockedRef.current = true; };
    primer.onerror = () => { diagnostic("speech_unlock_failed"); };
    window.speechSynthesis.speak(primer);
  }, []);

  const speakOnce = useCallback((requestId: string, text: string) => {
    if (spokenRequestIdRef.current === requestId || !("speechSynthesis" in window)) { setStatus("idle"); return; }
    spokenRequestIdRef.current = requestId;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 1.01;
    utterance.pitch = 0.96;
    const voices = window.speechSynthesis.getVoices();
    const britishVoice = voices.find((voice) => voice.lang.toLowerCase() === "en-gb") ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
    if (britishVoice) utterance.voice = britishVoice;
    let started = false;
    utterance.onstart = () => {
      started = true;
      if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
      diagnostic("speech_started", { requestId, playbackCount: 1, speechUnlocked: speechUnlockedRef.current });
      setStatus("speaking");
    };
    utterance.onboundary = () => {
      if (speechPulseRef.current) window.clearTimeout(speechPulseRef.current);
      orbRef.current?.style.setProperty("--voice-scale", "1.065");
      orbRef.current?.style.setProperty("--voice-brightness", "1.35");
      speechPulseRef.current = window.setTimeout(resetOrbLevel, 130);
    };
    utterance.onend = () => {
      if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
      diagnostic("speech_completed", { requestId, playbackCount: 1 });
      resetOrbLevel();
      setStatus("idle");
    };
    utterance.onerror = (event) => {
      if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
      diagnostic("speech_failed", { requestId, playbackCount: 0, error: event.error ?? "unknown" });
      resetOrbLevel();
      setRecoverableError("The signal is ready, but Safari blocked voice playback. Tap Try again to hear it.");
      setStatus("failure");
      spokenRequestIdRef.current = null;
    };
    diagnostic("speech_queued", { requestId, speechUnlocked: speechUnlockedRef.current, voiceAvailable: Boolean(britishVoice) });
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
    speechStartTimerRef.current = window.setTimeout(() => {
      if (!started && spokenRequestIdRef.current === requestId) {
        diagnostic("speech_start_timeout", { requestId, playbackCount: 0 });
        window.speechSynthesis.cancel();
        spokenRequestIdRef.current = null;
        setRecoverableError("The signal is ready, but Safari blocked voice playback. Tap Try again to hear it.");
        setStatus("failure");
      }
    }, 1800);
  }, [resetOrbLevel]);

  const submitTranscript = useCallback(async () => {
    const spokenPrompt = submittedTranscript(finalTranscriptRef.current || transcriptRef.current);
    if (!spokenPrompt) { diagnostic("transcript_rejected", { reason: "empty" }); setStatus("idle"); return; }
    if (requestInFlightRef.current || submittedTranscriptRef.current === spokenPrompt) { diagnostic("duplicate_request_guard", { inFlight: requestInFlightRef.current }); return; }
    requestInFlightRef.current = true;
    submittedTranscriptRef.current = spokenPrompt;
    const requestId = crypto.randomUUID();
    lastRequestIdRef.current = requestId;
    diagnostic("request_id_created", { requestId, transcriptLength: spokenPrompt.length, provider });
    setCycleLabel(selectLoadingState(cycleRef.current++));
    setRecoverableError(null);
    setStatus("submitting");
    try {
      diagnostic("post_started", { requestId, provider });
      const response = await fetch("/api/voice/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: spokenPrompt, provider, requestId }) });
      setStatus("validating");
      const body = await response.json() as Partial<BriefResponse> & { error?: string };
      diagnostic("post_completed", { requestId, status: response.status, ok: response.ok });
      if (!response.ok) throw new Error(body.error || language.voice.failure);
      if (body.requestId !== requestId || !isSignal(body.signal) || typeof body.speech !== "string" || !body.speech.trim()) {
        diagnostic("structured_validation_failed", { requestId });
        throw new Error(language.voice.failure);
      }
      diagnostic("structured_validation_passed", { requestId, signalId: body.signal.id, provider: body.diagnostics?.provider });
      if (lastRequestIdRef.current !== requestId) return;
      setStatus("persisted");
      setRecoverableError(null);
      setSignal(body.signal);
      diagnostic("frontend_signal_replacement", { requestId, signalId: body.signal.id });
      setStatus("rendered");
      setTranscript("");
      transcriptRef.current = "";
      finalTranscriptRef.current = "";
      window.requestAnimationFrame(() => speakOnce(requestId, body.speech as string));
    } catch (error) {
      resetOrbLevel();
      setRecoverableError(error instanceof Error ? error.message : language.voice.failure);
      setStatus("failure");
      submittedTranscriptRef.current = null;
    } finally { requestInFlightRef.current = false; }
  }, [provider, resetOrbLevel, speakOnce]);

  /**
   * Re-sends the transcript that already failed, so a provider error never
   * costs the user their spoken request. The final transcript is deliberately
   * left in place on failure; the duplicate guard is cleared with it so this
   * one resubmission is allowed through, and `requestInFlightRef` still stops
   * a second press landing while the first is in flight.
   */
  const retryLastRequest = useCallback(() => {
    if (requestInFlightRef.current) return;
    if (!submittedTranscript(finalTranscriptRef.current || transcriptRef.current)) {
      setRecoverableError(null);
      setStatus("idle");
      return;
    }
    // The retry press is itself a user gesture, which is the only moment iOS
    // Safari will arm speech playback. Re-arming here keeps the spoken
    // briefing working on a retry that follows a long pause.
    unlockSpeech();
    submittedTranscriptRef.current = null;
    spokenRequestIdRef.current = null;
    setRecoverableError(null);
    diagnostic("retry_requested", { reusedTranscript: true });
    void submitTranscript();
  }, [submitTranscript, unlockSpeech]);

  const finaliseListening = useCallback(() => {
    if (status !== "listening") return;
    stopRequestedRef.current = true;
    setStatus("finalising");
    diagnostic("recognition_stop_requested", { transcriptLength: transcriptRef.current.trim().length });
    recognitionRef.current?.stop();
    stopAudioMeter();
  }, [status, stopAudioMeter]);
  const cancelActive = useCallback(() => {
    window.speechSynthesis.cancel();
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    stopAudioMeter();
    setStatus("idle");
  }, [stopAudioMeter]);
  useEffect(() => () => {
    if (speechStartTimerRef.current !== null) window.clearTimeout(speechStartTimerRef.current);
    window.speechSynthesis.cancel();
    recognitionRef.current?.abort?.();
    stopAudioMeter();
  }, [stopAudioMeter]);

  const listen = useCallback(() => {
    if (requestInFlightRef.current) return;
    const browser = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) { setStatus("unsupported"); return; }
    unlockSpeech();
    setRecoverableError(null);
    submittedTranscriptRef.current = null;
    stopRequestedRef.current = false;
    finalTranscriptRef.current = "";
    transcriptRef.current = "";
    setTranscript("");
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-GB";
    recognition.onresult = (event) => {
      let combined = "";
      let final = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript?.trim() ?? "";
        if (text) combined = `${combined} ${text}`.trim();
        if (result?.isFinal && text) final = `${final} ${text}`.trim();
      }
      transcriptRef.current = combined;
      if (final) finalTranscriptRef.current = final;
      setTranscript(combined);
      diagnostic("recognition_result", { final: Boolean(final), transcriptLength: combined.length });
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      stopAudioMeter();
      const accepted = (finalTranscriptRef.current || transcriptRef.current).trim();
      diagnostic("recognition_end", { stopRequested: stopRequestedRef.current, transcriptAccepted: Boolean(accepted), finalResult: Boolean(finalTranscriptRef.current) });
      if (accepted) { diagnostic("transcript_accepted", { transcriptLength: accepted.length }); void submitTranscript(); }
      else { diagnostic("transcript_rejected", { reason: "empty_on_end" }); setStatus("idle"); }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      stopAudioMeter();
      diagnostic("recognition_error", { code: event?.error ?? "unknown" });
      if ((finalTranscriptRef.current || transcriptRef.current).trim()) void submitTranscript();
      else { setRecoverableError(language.voice.failure); setStatus("failure"); }
    };
    recognitionRef.current = recognition;
    recognition.start();
    void startAudioMeter();
    setStatus("listening");
  }, [startAudioMeter, stopAudioMeter, submitTranscript, unlockSpeech]);

  const displayedAction = displayedSignal?.highestLeverageRecommendation ?? state.action?.title ?? language.trajectory.continueObserving;
  const displayedState = displayedSignal?.currentObservation ?? directionCopy[state.trajectory];
  const displayedConstraint = displayedSignal?.currentConstraint ?? (state.bottleneck ? language.experience.currentConstraint(state.bottleneck) : language.trajectory.noConstraint);
  const displayedImpact = displayedSignal?.expectedImpact ?? expectedShift(state);
  const displayedReasoning = displayedSignal?.reasoning ?? state.reasoning ?? state.action?.why ?? language.trajectory.preserveLeverage;
  const displayedTime = displayedSignal?.computedAt ?? state.computedAt;
  const displayedRisk = displayedSignal?.riskLevel ?? state.riskLevel;
  const signalPresentation = presentSignal({
    status,
    hasSignal: Boolean(displayedSignal),
    computedAt: displayedTime,
    currentLabel: language.headings.executiveSignal,
  });
  const statusLabel = status === "idle" ? language.status.observingQuietly : status === "listening" ? language.status.listening : status === "speaking" ? language.status.speaking : status === "failure" ? language.voice.failure : status === "unsupported" ? language.status.voiceUnavailable : cycleLabel;
  const onOrbClick = status === "listening" ? finaliseListening : status === "speaking" ? cancelActive : active ? undefined : listen;
  const interactionHint = status === "unsupported" ? language.voice.unavailableInBrowser : status === "listening" ? language.voice.tapToStop : active ? null : language.voice.tapToSpeak;

  return (
    <main
      className={`trajectory-experience light-${lightTone[displayedRisk]} status-${status}`}
      data-phase={orbPhase}
      data-ambient={pageActive ? "live" : "paused"}
      data-motion={reducedMotion ? "reduced" : "full"}
    >
      <div className="star-field" aria-hidden="true"><div className="stars stars-near" /><div className="stars stars-far" /><div className="milky-way" /><div className="cosmic-dust" /><div className="nebula" /><div className="distant-galaxy galaxy-one" /><div className="distant-galaxy galaxy-two" /><AmbientShootingStar /></div>
      <div className="edge-light" aria-hidden="true" />
      <header className="experience-header">
        <a className="wordmark" href="#intelligence" aria-label={language.brand.homeLabel}><TrajectoryMark /><span>{language.brand.name}</span><sup>©</sup></a>
        <div className="header-controls"><label className="provider-setting"><span className="sr-only">{language.brand.providerLabel}</span><select value={provider} onChange={(event) => chooseProvider(event.target.value as ProviderPreference)} aria-label={language.brand.providerLabel}><option value="auto">{language.brand.automaticProvider}</option>{providers.map((option) => <option key={option.id} value={option.id} disabled={!option.configured}>{option.label}{option.configured ? "" : language.brand.unavailableSuffix}</option>)}</select></label><div className="presence"><span className="presence-dot" /><span>{statusLabel}</span></div></div>
      </header>
      <section className="intelligence-stage" id="intelligence" aria-label={language.brand.intelligenceRegion}>
        <button ref={orbRef} type="button" className={`orb-system is-${status}`} data-phase={orbPhase} onClick={onOrbClick} disabled={status === "unsupported" || (active && status !== "listening" && status !== "speaking")} aria-label={status === "listening" ? language.voice.stopInteraction : language.voice.speakToTrajectory}>
          <div className="orb-passing-star" aria-hidden="true" /><div className="watch-stream stream-one" /><div className="watch-stream stream-two" /><div className="orb-halo halo-one" /><div className="orb-halo halo-two" /><div className="speech-wave speech-wave-one" /><div className="speech-wave speech-wave-two" /><div className="orb-ring ring-one"><span /></div><div className="orb-ring ring-two"><span /></div><div className="trajectory-orb"><div className="orb-atmosphere" /><div className="orb-energy" /><div className="orb-circulation" /><div className="orb-glass" /><div className="orb-reflection" /></div>
        </button>
        <div className="orb-copy" aria-live="polite"><p className="orb-kicker">{language.brand.descriptor}</p><h1>{status === "listening" ? language.voice.listening : language.experience.greeting(ownerName)}</h1>{["idle", "unsupported", "failure"].includes(status) ? <div className="wake-dialogue"><p>{language.experience.meaningfulChanges(state.meaningfulChanges)}</p><p>{language.trajectory.leverageReady}</p></div> : <p className="live-voice-copy">{transcript ? transcriptForDisplay(transcript) : statusLabel}</p>}</div>
        {interactionHint ? <p className="interaction-hint">{interactionHint}</p> : null}
        {recoverableError ? <button type="button" className="voice-error" onClick={retryLastRequest}>{recoverableError} · Try again with the same request</button> : null}
      </section>
      <section className={`briefing-card${displayedSignal ? " signal-updated" : ""}`} data-signal-stage={signalStage} data-freshness={signalPresentation.freshness} aria-labelledby="briefing-title" aria-live="polite">
        <SignalCrossing active={crossing} />
        <div className="card-eyebrow"><span><TrajectoryMark className="mark-inline" /> {signalPresentation.label}</span>{signalPresentation.marked ? null : <time dateTime={displayedTime}>{new Date(displayedTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>}</div>
        {signalPresentation.marked ? <p className="signal-stale-note">This is the last signal Trajectory generated. It was not produced for your latest request.</p> : null}
        <div className="signal-body" ref={bodyRef} style={lockedHeight ? { minHeight: lockedHeight } : undefined}>
          <div className="briefing-primary"><p>{language.headings.highestLeverageAction}</p><h2 id="briefing-title">{displayedAction}</h2></div>
          <div className="briefing-details"><div><span>{language.headings.currentState}</span><p>{displayedState}</p></div><div><span>{language.headings.currentDynamics}</span><p>{displayedConstraint}</p></div><div><span>{language.headings.expectedShift}</span><p>{displayedImpact}</p></div><div><span>{language.headings.trajectoryLogic}</span><p>{displayedReasoning}</p></div>{displayedSignal ? <><div><span>Confidence</span><p>{Math.round(displayedSignal.confidence * 100)}%</p></div><div><span>Urgency</span><p>{Math.round(displayedSignal.urgency * 100)}%</p></div><div><span>Suggested next action</span><p>{displayedSignal.suggestedNextAction}</p></div></> : null}</div>
        </div>
      </section>
    </main>
  );
}
