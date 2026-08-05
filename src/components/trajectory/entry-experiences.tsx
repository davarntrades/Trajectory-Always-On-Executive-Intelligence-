"use client";

import { useMemo, useState } from "react";
import type { PersonalProfile, MorningCheckIn } from "@/lib/personalization";
import type { ProviderOption } from "@/lib/providers/types";

const goalAreas = ["Business", "Career", "Health", "Fitness", "Faith", "Relationships", "Finances", "Learning", "Personal recovery", "Other"];
const factors = ["Feeling ill", "Poor sleep", "Travelling", "Big meeting", "Deadline", "Family commitment", "High stress", "Recovery day", "Other"];

export function EntryExperiences({ initialProfile, initialCheckIn, showMorningCheckIn, providers }: {
  initialProfile: PersonalProfile;
  initialCheckIn: MorningCheckIn | null;
  showMorningCheckIn: boolean;
  providers: ProviderOption[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [onboardingOpen, setOnboardingOpen] = useState(!initialProfile.onboardingCompletedAt);
  const [checkInOpen, setCheckInOpen] = useState(showMorningCheckIn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<"high" | "normal" | "low">(initialCheckIn?.capacity ?? "normal");
  const [rejuvenation, setRejuvenation] = useState<"fully_restored" | "okay" | "drained">(initialCheckIn?.rejuvenation ?? "okay");
  const [sleepQuality, setSleepQuality] = useState<"great" | "okay" | "poor">(initialCheckIn?.sleepQuality ?? "okay");
  const [selectedFactors, setSelectedFactors] = useState<string[]>(initialCheckIn?.factors ?? []);
  const [note, setNote] = useState(initialCheckIn?.note ?? "");
  const zones = useMemo(() => [profile.timezone, "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"].filter((value, index, list) => list.indexOf(value) === index), [profile.timezone]);

  const saveOnboarding = async () => {
    if (profile.priorityAreas.length !== 3) { setError("Choose three priority areas."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...profile, completeOnboarding: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Profile could not be saved.");
      setProfile(body); setOnboardingOpen(false); window.location.reload();
    } catch (value) { setError(value instanceof Error ? value.message : "Profile could not be saved."); }
    finally { setSaving(false); }
  };

  const saveCheckIn = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/check-in", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ capacity, rejuvenation, sleepQuality, factors: selectedFactors, note }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Check-in could not be saved.");
      setCheckInOpen(false); window.location.reload();
    } catch (value) { setError(value instanceof Error ? value.message : "Check-in could not be saved."); }
    finally { setSaving(false); }
  };

  if (!onboardingOpen && !checkInOpen) return null;
  return <div className="trajectory-overlay" role="dialog" aria-modal="true">
    <div className="trajectory-focus-card">
      {onboardingOpen ? <>
        <p className="orb-kicker">Personalise your trajectory</p>
        <h2>Begin with what matters most.</h2>
        <label>What should Trajectory call you?<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} autoComplete="name" /></label>
        <label>Pronouns <span>(optional)</span><input value={profile.pronouns ?? ""} onChange={(event) => setProfile({ ...profile, pronouns: event.target.value })} /></label>
        <label>Time zone<select value={profile.timezone} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <label>Typical wake-up time<input type="time" value={profile.wakeTime} onChange={(event) => setProfile({ ...profile, wakeTime: event.target.value })} /></label>
        <fieldset><legend>Choose three priority areas</legend><div className="choice-grid">{goalAreas.map((area) => <button type="button" key={area} className={profile.priorityAreas.includes(area) ? "selected" : ""} onClick={() => setProfile({ ...profile, priorityAreas: profile.priorityAreas.includes(area) ? profile.priorityAreas.filter((item) => item !== area) : profile.priorityAreas.length < 3 ? [...profile.priorityAreas, area] : profile.priorityAreas })}>{area}</button>)}</div></fieldset>
        <fieldset><legend>How involved should Trajectory be?</legend><div className="choice-grid">{(["minimal", "balanced", "proactive"] as const).map((level) => <button type="button" key={level} className={profile.involvementLevel === level ? "selected" : ""} onClick={() => setProfile({ ...profile, involvementLevel: level })}>{level[0].toUpperCase() + level.slice(1)}</button>)}</div></fieldset>
        <label>Preferred provider<select value={profile.provider} onChange={(event) => setProfile({ ...profile, provider: event.target.value as PersonalProfile["provider"] })}><option value="auto">Automatic</option>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.configured}>{provider.label}</option>)}</select></label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="button" className="primary-action" disabled={saving} onClick={saveOnboarding}>{saving ? "Saving…" : "Set my trajectory"}</button>
      </> : <>
        <p className="orb-kicker">Morning check-in</p><h2>How much capacity do you have today?</h2>
        <ChoiceRow values={["high", "normal", "low"]} selected={capacity} onSelect={(value) => setCapacity(value as typeof capacity)} />
        <h3>How rejuvenated do you feel?</h3><ChoiceRow values={["fully restored", "okay", "drained"]} selected={rejuvenation.replace("_", " ")} onSelect={(value) => setRejuvenation(value.replace(" ", "_") as typeof rejuvenation)} />
        <h3>How did you sleep?</h3><ChoiceRow values={["great", "okay", "poor"]} selected={sleepQuality} onSelect={(value) => setSleepQuality(value as typeof sleepQuality)} />
        <fieldset><legend>Is anything affecting today?</legend><div className="choice-grid">{factors.map((factor) => <button type="button" key={factor} className={selectedFactors.includes(factor) ? "selected" : ""} onClick={() => setSelectedFactors(selectedFactors.includes(factor) ? selectedFactors.filter((item) => item !== factor) : [...selectedFactors, factor])}>{factor}</button>)}</div></fieldset>
        <label>Optional note<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Anything Trajectory should account for today?" /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="button" className="primary-action" disabled={saving} onClick={saveCheckIn}>{saving ? "Integrating…" : "Continue"}</button>
      </>}
    </div>
  </div>;
}

function ChoiceRow({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (value: string) => void }) {
  return <div className="choice-grid">{values.map((value) => <button type="button" key={value} className={selected === value ? "selected" : ""} onClick={() => onSelect(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>;
}
