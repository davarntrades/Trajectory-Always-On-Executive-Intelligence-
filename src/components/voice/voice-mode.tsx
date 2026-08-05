"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/panel";
import { selectLoadingState, trajectoryLanguage as language } from "@/content/trajectory-language";

type Status = "idle" | "integrating" | "speaking" | "listening" | "unsupported";
interface BriefResponse { speech: string; lines: string[] }
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}
const subscribeNoop = () => () => {};
const supportsSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function VoiceMode() {
  const supported = useSyncExternalStore(subscribeNoop, supportsSpeech, () => true);
  const [rawStatus, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [heard, setHeard] = useState("");
  const [cycleLabel, setCycleLabel] = useState<string>(language.loadingStates.integratingObservations);
  const cycleRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const status: Status = supported ? rawStatus : "unsupported";

  const stopSpeaking = useCallback(() => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);
  const startListening = useCallback(() => {
    const browser = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = false; recognition.interimResults = true; recognition.lang = "en-GB";
    recognition.onresult = (event) => { stopSpeaking(); const latest = event.results[event.results.length - 1]; setHeard(latest?.[0]?.transcript ?? ""); setStatus("listening"); };
    recognition.onend = () => setStatus("idle"); recognition.onerror = () => setStatus("idle");
    recognitionRef.current = recognition; recognition.start(); setStatus("listening");
  }, [stopSpeaking]);
  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    stopSpeaking(); const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 1.05; utterance.pitch = 1; utterance.lang = "en-GB"; utterance.onend = () => setStatus("idle"); setStatus("speaking"); window.speechSynthesis.speak(utterance);
  }, [stopSpeaking]);
  const brief = useCallback(async () => {
    setCycleLabel(selectLoadingState(cycleRef.current++)); setStatus("integrating"); setHeard("");
    try { const response = await fetch("/api/voice/brief"); if (!response.ok) throw new Error(`voice brief ${response.status}`); const data = (await response.json()) as BriefResponse; setLines(data.lines); speak(data.speech); startListening(); }
    catch { setStatus("idle"); setLines([language.voice.failure]); }
  }, [speak, startListening]);
  const stop = useCallback(() => { stopSpeaking(); recognitionRef.current?.stop(); setStatus("idle"); }, [stopSpeaking]);
  const busy = status === "speaking" || status === "listening" || status === "integrating";
  const statusCopy: Record<Status, string> = { idle: language.status.idle, integrating: cycleLabel, speaking: language.status.speaking, listening: language.status.listening, unsupported: language.status.unsupported };

  return <div className="rounded-xl border border-border bg-surface/70 p-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{language.headings.voice}</h2><p className="mt-0.5 text-xs text-faint">{language.voice.proactiveBrief}</p></div><Badge tone={status === "speaking" ? "accent" : status === "listening" ? "positive" : status === "unsupported" ? "negative" : "neutral"}>{statusCopy[status]}</Badge></div>
    <div className="mt-3 flex gap-2"><button type="button" onClick={brief} disabled={status === "unsupported" || status === "integrating"} className="flex-1 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40">{status === "integrating" ? cycleLabel : language.voice.briefMe}</button><button type="button" onClick={stop} disabled={!busy} className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40">{language.voice.stop}</button></div>
    {heard ? <p className="mt-3 rounded-md border border-positive/30 bg-positive/5 px-3 py-2 text-xs text-muted"><span className="text-positive">{language.voice.heardPrefix}</span> {heard}</p> : null}
    {lines.length > 0 ? <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">{lines.map((line, index) => <li key={index} className="text-xs leading-relaxed text-muted">{line}</li>)}</ul> : <p className="mt-3 text-xs leading-relaxed text-faint">{language.voice.empty}</p>}
    {status === "unsupported" ? <p className="mt-2 text-[11px] text-negative">{language.voice.unsupported}</p> : null}
  </div>;
}
