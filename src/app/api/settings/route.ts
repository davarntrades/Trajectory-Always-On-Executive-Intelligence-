import { NextResponse } from "next/server";
import { z } from "zod";
import { providerPreferences } from "@/lib/providers";
import { getWorkspaceRepository } from "@/lib/workspace/repository";

export const dynamic = "force-dynamic";

const SettingsInput = z.object({
  provider: z.enum(providerPreferences).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  voiceEnabled: z.boolean().optional(),
  backgroundIntelligenceEnabled: z.boolean().optional(),
  dailyBriefEnabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ settings: await repository.getSettings() });
}

export async function PATCH(request: Request) {
  const input = SettingsInput.parse(await request.json());
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ settings: await repository.updateSettings(input) });
}
