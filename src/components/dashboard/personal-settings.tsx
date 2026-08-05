"use client";

import { useState } from "react";
import type { PersonalProfile } from "@/lib/personalization";
import type { ProviderOption } from "@/lib/providers/types";

export function PersonalSettings({ initialProfile, providers }: { initialProfile: PersonalProfile; providers: ProviderOption[] }) {
  const [profile, setProfile] = useState(initialProfile);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Settings could not be saved.");
      setProfile(body); setStatus("Settings saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Settings could not be saved."); }
    finally { setSaving(false); }
  };

  return <div className="personal-settings">
    <label>Display name<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
    <label>Pronouns <span>(optional)</span><input value={profile.pronouns ?? ""} onChange={(event) => setProfile({ ...profile, pronouns: event.target.value })} /></label>
    <label>Time zone<input value={profile.timezone} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })} /></label>
    <div className="settings-pair"><label>Wake-up<input type="time" value={profile.wakeTime} onChange={(event) => setProfile({ ...profile, wakeTime: event.target.value })} /></label><label>Bedtime <span>(optional)</span><input type="time" value={profile.bedtime ?? ""} onChange={(event) => setProfile({ ...profile, bedtime: event.target.value })} /></label></div>
    <label>Preferred provider<select value={profile.provider} onChange={(event) => setProfile({ ...profile, provider: event.target.value as PersonalProfile["provider"] })}><option value="auto">Automatic</option>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.configured}>{provider.label}</option>)}</select></label>
    <label>Trajectory involvement<select value={profile.involvementLevel} onChange={(event) => setProfile({ ...profile, involvementLevel: event.target.value as PersonalProfile["involvementLevel"] })}><option value="minimal">Minimal</option><option value="balanced">Balanced</option><option value="proactive">Proactive</option></select></label>
    <label className="settings-toggle"><input type="checkbox" checked={Boolean(profile.notificationPreferences.daily_brief)} onChange={(event) => setProfile({ ...profile, notificationPreferences: { ...profile.notificationPreferences, daily_brief: event.target.checked } })} />Daily summaries</label>
    <label className="settings-toggle"><input type="checkbox" checked={Boolean(profile.notificationPreferences.executive_signals)} onChange={(event) => setProfile({ ...profile, notificationPreferences: { ...profile.notificationPreferences, executive_signals: event.target.checked } })} />Executive Signal notifications</label>
    <label className="settings-toggle"><input type="checkbox" checked={profile.voicePreferences.enabled !== false} onChange={(event) => setProfile({ ...profile, voicePreferences: { ...profile.voicePreferences, enabled: event.target.checked } })} />Spoken responses</label>
    <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
    {status ? <p aria-live="polite">{status}</p> : null}
  </div>;
}
