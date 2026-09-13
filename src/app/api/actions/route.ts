import { NextResponse } from "next/server";
import { z } from "zod";
import { decide, execute, propose } from "@/lib/actions";
import { getStore } from "@/lib/store";
import { AuthenticationRequiredError, requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const Propose = z.object({
  op: z.literal("propose"),
  connectorId: z.string().optional(),
  capability: z.string().min(1),
  requestedTier: z.enum(["observe", "recommend", "draft", "approve", "execute"]),
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  rationale: z.string().optional(),
});

const Decide = z.object({
  op: z.literal("decide"),
  actionId: z.string().min(1),
  outcome: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
});

const Execute = z.object({
  op: z.literal("execute"),
  actionId: z.string().min(1),
});

const Body = z.discriminatedUnion("op", [Propose, Decide, Execute]);

/**
 * Every other route in this API answers an unauthenticated request with 401.
 * This one relied on `getStore()` throwing and returned 500, which reads as a
 * server fault rather than a missing session.
 */
function unauthorised(error: unknown) {
  return error instanceof AuthenticationRequiredError
    ? NextResponse.json({ error: "Authentication required." }, { status: 401 })
    : null;
}

export async function GET() {
  try {
    await requireUser();
    const store = await getStore();
    const [actions, audit] = await Promise.all([store.actions(), store.auditLog(50)]);
    return NextResponse.json({ actions, audit });
  } catch (error) {
    return unauthorised(error) ?? NextResponse.json({ error: "Actions could not be read." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid payload", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  try {
    // Proposal and execution were reachable without an explicit session check.
    // They are owner-scoped operations on owner-scoped rows and must establish
    // the principal before anything else happens.
    const user = await requireUser();

    switch (body.op) {
      case "propose": {
        const action = await propose(body);
        return NextResponse.json({ action });
      }
      case "decide": {
        const action = await decide(body.actionId, body.outcome, user.id, body.note);
        if (!action) return NextResponse.json({ error: "action not found" }, { status: 404 });
        return NextResponse.json({ action });
      }
      case "execute": {
        const action = await execute(body.actionId);
        if (!action) return NextResponse.json({ error: "action not found" }, { status: 404 });
        return NextResponse.json({ action });
      }
    }
  } catch (error) {
    return unauthorised(error) ?? NextResponse.json({ error: "Action could not be processed." }, { status: 500 });
  }
}
