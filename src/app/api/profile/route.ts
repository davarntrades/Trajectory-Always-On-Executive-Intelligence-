import { NextResponse } from "next/server";
import { z } from "zod";
import { getPersonalProfile, savePersonalProfile } from "@/lib/personalization";
import { providerPreferences } from "@/lib/providers";

export const dynamic = "force-dynamic";

const ProfileInput = z.object({
  displayName: z.string().trim().min(1).max(80),
  pronouns: z.string().trim().max(60).optional(),
  timezone: z.string().trim().min(1).max(100),
  wakeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  bedtime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
  provider: z.enum(providerPreferences),
  involvementLevel: z.enum(["minimal", "balanced", "proactive"]),
  notificationPreferences: z.record(z.string(), z.boolean()),
  voicePreferences: z.record(z.string(), z.unknown()),
  priorityAreas: z.array(z.string().trim().min(1).max(80)).max(3),
  completeOnboarding: z.boolean().optional(),
});

export async function GET() {
  try { return NextResponse.json(await getPersonalProfile()); }
  catch { return NextResponse.json({ error: "Profile is unavailable." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const input = ProfileInput.parse(await request.json());
    return NextResponse.json(await savePersonalProfile(input));
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Check the profile details and try again." : "Profile changes could not be saved." }, { status: 400 });
  }
}
