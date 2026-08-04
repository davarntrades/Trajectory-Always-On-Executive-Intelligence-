import { NextResponse } from "next/server";
import { z } from "zod";
import { toEvent } from "@/lib/connectors";
import { computeState } from "@/lib/state/compute";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Event ingest.
 *
 * The autonomy surface: connectors, webhooks and manual pushes all land here.
 * New events trigger a state recompute, which is what makes Trajectory update
 * its own understanding when something happens rather than when it is asked.
 */
const EventInput = z.object({
  source: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  occurredAt: z.string().optional(),
  externalId: z.string().optional(),
  entityIds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const Body = z.object({
  events: z.array(EventInput).min(1),
  recompute: z.boolean().optional(),
});

export async function GET(request: Request) {
  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const events = await (await getStore()).events(days);
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid payload", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const store = await getStore();
  const events = parsed.events.map((e) =>
    toEvent({ ...e, occurredAt: e.occurredAt ?? new Date().toISOString() }),
  );

  const added = await store.appendEvents(events);

  await store.appendAudit({
    at: new Date().toISOString(),
    actor: "ingest",
    event: "events_received",
    tier: "observe",
    detail: { received: events.length, added },
  });

  // Recompute by default — an observation that does not update state is inert.
  const state =
    parsed.recompute === false || added === 0
      ? undefined
      : await computeState({ persist: true });

  return NextResponse.json({ received: events.length, added, state });
}
