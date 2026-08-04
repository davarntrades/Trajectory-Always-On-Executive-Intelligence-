import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceRepository } from "@/lib/workspace/repository";

export const dynamic = "force-dynamic";

const GoalInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).optional(),
  horizon: z.enum(["week", "month", "quarter", "year"]).optional(),
  target: z.string().trim().max(500).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  status: z.enum(["active", "achieved", "abandoned"]).optional(),
});

export async function GET() {
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ goals: await repository.listGoals() });
}

async function upsert(request: Request, status: number) {
  const input = GoalInput.parse(await request.json());
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ goal: await repository.upsertGoal(input) }, { status });
}

export async function POST(request: Request) { return upsert(request, 201); }
export async function PATCH(request: Request) { return upsert(request, 200); }
