import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceRepository } from "@/lib/workspace/repository";

export const dynamic = "force-dynamic";

const CreateMessage = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().trim().min(1).max(50_000),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ messages: await repository.listMessages(id, limit) });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const input = CreateMessage.parse(await request.json());
  const repository = await getWorkspaceRepository();
  const message = await repository.appendMessage({ conversationId: id, ...input });
  return NextResponse.json({ message }, { status: 201 });
}
