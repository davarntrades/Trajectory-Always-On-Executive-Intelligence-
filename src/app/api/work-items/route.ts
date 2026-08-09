import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationRequiredError } from "@/lib/auth/session";
import { buildWorkBoard, buildEvidenceReferences, rankOpenWork } from "@/lib/work/canonical";
import { createLaunchTask, listWorkItems, setActivePriority, setWorkItemStatus } from "@/lib/work/repository";
import { workItemStatuses } from "@/lib/work/types";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().trim().min(3).max(280),
  detail: z.string().trim().max(2000).optional(),
});

const UpdateBody = z.object({
  id: z.string().trim().min(1).max(300),
  status: z.enum(workItemStatuses).optional(),
  activate: z.boolean().optional(),
});

function unauthorised(error: unknown) {
  return error instanceof AuthenticationRequiredError
    ? NextResponse.json({ error: "Authentication required." }, { status: 401 })
    : null;
}

export async function GET() {
  try {
    const items = await listWorkItems();
    return NextResponse.json(
      {
        board: buildWorkBoard(items),
        openCount: rankOpenWork(items).length,
        evidence: buildEvidenceReferences(items),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return unauthorised(error) ?? NextResponse.json({ error: "Work items could not be read." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = CreateBody.parse(await request.json());
    return NextResponse.json(await createLaunchTask(input), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "A launch task needs a title of at least three characters." }, { status: 400 });
    }
    return unauthorised(error) ?? NextResponse.json({ error: "Launch task could not be created." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const input = UpdateBody.parse(await request.json());
    // Activation is its own operation because promoting one item must demote
    // any other, which a plain status write cannot express.
    if (input.activate) await setActivePriority(input.id);
    else if (input.status) await setWorkItemStatus(input.id, input.status);
    else return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    const items = await listWorkItems();
    return NextResponse.json({ board: buildWorkBoard(items), openCount: rankOpenWork(items).length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Unrecognised work item update." }, { status: 400 });
    }
    return unauthorised(error) ?? NextResponse.json({ error: "Work item could not be updated." }, { status: 500 });
  }
}
