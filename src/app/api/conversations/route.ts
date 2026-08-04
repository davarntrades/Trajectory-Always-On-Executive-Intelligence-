import { NextResponse } from "next/server";
import { z } from "zod";
import { providerIds } from "@/lib/providers";
import { getWorkspaceRepository } from "@/lib/workspace/repository";

export const dynamic = "force-dynamic";

const CreateConversation = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  provider: z.enum(providerIds).optional(),
});

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ conversations: await repository.listConversations(limit) });
}

export async function POST(request: Request) {
  const input = CreateConversation.parse(await request.json());
  const repository = await getWorkspaceRepository();
  const conversation = await repository.createConversation(input.title, input.provider);
  return NextResponse.json({ conversation }, { status: 201 });
}
