import { NextResponse } from "next/server";
import { getWorkspaceRepository } from "@/lib/workspace/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  const repository = await getWorkspaceRepository();
  return NextResponse.json({ briefs: await repository.listBriefs(limit) });
}
