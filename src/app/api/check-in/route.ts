import { NextResponse } from "next/server";
import { z } from "zod";
import { getPersonalProfile, getTodayCheckIn, saveMorningCheckIn } from "@/lib/personalization";

export const dynamic = "force-dynamic";

const CheckInInput = z.object({
  capacity: z.enum(["high", "normal", "low"]),
  rejuvenation: z.enum(["fully_restored", "okay", "drained"]),
  sleepQuality: z.enum(["great", "okay", "poor"]),
  factors: z.array(z.string().trim().min(1).max(80)).max(8),
  note: z.string().trim().max(500).optional(),
});

export async function GET() {
  try {
    const profile = await getPersonalProfile();
    return NextResponse.json({ checkIn: await getTodayCheckIn(profile), timezone: profile.timezone });
  } catch { return NextResponse.json({ error: "Today’s check-in is unavailable." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const input = CheckInInput.parse(await request.json());
    const profile = await getPersonalProfile();
    const checkIn = await saveMorningCheckIn({ ...input, timezone: profile.timezone });
    return NextResponse.json({ checkIn });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Complete the check-in before continuing." : "Today’s check-in could not be saved." }, { status: 400 });
  }
}
