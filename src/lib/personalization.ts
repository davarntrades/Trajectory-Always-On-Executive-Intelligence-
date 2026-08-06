import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import type { ProviderPreference } from "@/lib/providers/types";

export type InvolvementLevel = "minimal" | "balanced" | "proactive";
export type Capacity = "high" | "normal" | "low";
export type Rejuvenation = "fully_restored" | "okay" | "drained";
export type SleepQuality = "great" | "okay" | "poor";

export interface PersonalProfile {
  displayName: string;
  pronouns?: string;
  timezone: string;
  wakeTime: string;
  bedtime?: string;
  provider: ProviderPreference;
  involvementLevel: InvolvementLevel;
  notificationPreferences: Record<string, boolean>;
  voicePreferences: Record<string, unknown>;
  priorityAreas: string[];
  onboardingCompletedAt?: string;
}

export interface MorningCheckIn {
  id: string;
  localDate: string;
  timezone: string;
  capacity: Capacity;
  rejuvenation: Rejuvenation;
  sleepQuality: SleepQuality;
  factors: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

const defaultProfile: PersonalProfile = {
  displayName: "there",
  timezone: "Europe/London",
  wakeTime: "08:00",
  provider: "auto",
  involvementLevel: "balanced",
  notificationPreferences: { daily_brief: true, executive_signals: true },
  voicePreferences: { enabled: true, rate: 1.01, pitch: 0.96, language: "en-GB" },
  priorityAreas: [],
};

export async function getPersonalProfile(): Promise<PersonalProfile> {
  const user = await requireUser();
  const client = await createClient();
  const { data, error } = await client.from("profiles").select("display_name, pronouns, timezone, wake_time, bedtime, provider, involvement_level, notification_preferences, voice_preferences, priority_areas, onboarding_completed_at").eq("id", user.id).single();
  if (error) throw new Error(`profile: ${error.message}`);
  return {
    displayName: data.display_name || user.displayName || defaultProfile.displayName,
    pronouns: data.pronouns ?? undefined,
    timezone: data.timezone || defaultProfile.timezone,
    wakeTime: String(data.wake_time || defaultProfile.wakeTime).slice(0, 5),
    bedtime: data.bedtime ? String(data.bedtime).slice(0, 5) : undefined,
    provider: (data.provider as ProviderPreference) || "auto",
    involvementLevel: (data.involvement_level as InvolvementLevel) || "balanced",
    notificationPreferences: data.notification_preferences ?? defaultProfile.notificationPreferences,
    voicePreferences: data.voice_preferences ?? defaultProfile.voicePreferences,
    priorityAreas: data.priority_areas ?? [],
    onboardingCompletedAt: data.onboarding_completed_at ?? undefined,
  };
}

export async function savePersonalProfile(input: PersonalProfile & { completeOnboarding?: boolean }) {
  const user = await requireUser();
  const client = await createClient();
  const now = new Date().toISOString();
  const { error } = await client.from("profiles").update({
    display_name: input.displayName.trim().slice(0, 80),
    pronouns: input.pronouns?.trim().slice(0, 60) || null,
    timezone: input.timezone,
    wake_time: input.wakeTime,
    bedtime: input.bedtime || null,
    provider: input.provider,
    involvement_level: input.involvementLevel,
    notification_preferences: input.notificationPreferences,
    voice_preferences: input.voicePreferences,
    priority_areas: input.priorityAreas.slice(0, 3),
    ...(input.completeOnboarding ? { onboarding_completed_at: now } : {}),
    updated_at: now,
  }).eq("id", user.id);
  if (error) throw new Error(`save profile: ${error.message}`);
  return getPersonalProfile();
}

export function localDate(timezone: string, at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function localMinutes(timezone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export async function getTodayCheckIn(profile?: PersonalProfile): Promise<MorningCheckIn | null> {
  const user = await requireUser();
  const resolved = profile ?? await getPersonalProfile();
  const client = await createClient();
  const date = localDate(resolved.timezone);
  const { data, error } = await client.from("morning_check_ins").select("*").eq("user_id", user.id).eq("local_date", date).maybeSingle();
  if (error) throw new Error(`morning check-in: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    localDate: data.local_date,
    timezone: data.timezone,
    capacity: data.capacity,
    rejuvenation: data.rejuvenation,
    sleepQuality: data.sleep_quality,
    factors: data.factors ?? [],
    note: data.note ?? undefined,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function shouldShowMorningCheckIn(profile: PersonalProfile, existing: MorningCheckIn | null) {
  if (existing || !profile.onboardingCompletedAt) return false;
  const [hour, minute] = profile.wakeTime.split(":").map(Number);
  return localMinutes(profile.timezone) >= hour * 60 + minute;
}

export async function saveMorningCheckIn(input: Omit<MorningCheckIn, "id" | "localDate" | "createdAt" | "updatedAt">) {
  const user = await requireUser();
  const client = await createClient();
  const date = localDate(input.timezone);
  const { data, error } = await client.from("morning_check_ins").upsert({
    user_id: user.id,
    local_date: date,
    timezone: input.timezone,
    capacity: input.capacity,
    rejuvenation: input.rejuvenation,
    sleep_quality: input.sleepQuality,
    factors: input.factors,
    note: input.note?.trim().slice(0, 500) || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,local_date" }).select("*").single();
  if (error) throw new Error(`save morning check-in: ${error.message}`);
  return data;
}

export function checkInContext(checkIn: MorningCheckIn | null) {
  if (!checkIn) return "No morning check-in has been recorded for today.";
  return [
    `User-reported state: capacity ${checkIn.capacity}; rejuvenation ${checkIn.rejuvenation}; sleep ${checkIn.sleepQuality}.`,
    checkIn.factors.length ? `User-reported factors: ${checkIn.factors.join(", ")}.` : "No additional factors reported.",
    checkIn.note ? `User note: ${checkIn.note}` : "",
    "Treat these as self-reported operating constraints, not medical diagnoses.",
  ].filter(Boolean).join(" ");
}
