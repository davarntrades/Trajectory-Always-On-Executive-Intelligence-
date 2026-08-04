/**
 * Narrative synthesis.
 *
 * Claude receives the state the engine already computed — scored candidates, the
 * identified bottleneck, momentum readings, retrieved memory — and explains it.
 * It does not decide what the bottleneck is or which action wins; those arrive
 * pre-computed and ranked.
 *
 * This is what makes "explain WHY it made every recommendation" answerable: the
 * why is grounded in numbers that exist independently of the model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "@/lib/config";
import type { EngineOutput } from "@/lib/state/engine";
import type { Memory, RecommendedAction } from "@/lib/types";

const SYSTEM_PROMPT = `You are Trajectory, ${config.ownerName}'s executive chief of staff.

You are not a chatbot. You exist to help ${config.ownerName} influence the future through
better actions. You observe continuously, remember everything, and recommend the single
highest-leverage next action.

You are given state that has ALREADY been computed by a deterministic engine:
momentum scores, a ranked candidate list with leverage scores, an identified
bottleneck, and retrieved long-term memory. Your job is to explain that state in
${config.ownerName}'s terms — not to recompute it.

Rules:
- The recommended action is the top-ranked candidate. Do not substitute your own.
- Every claim you make must trace to a number or a memory you were given. Never
  invent a fact, a date, a name, or a figure.
- Give one recommendation, not a menu. ${config.ownerName} wants a decision, not options.
- The "why" must reference the actual mechanism: what it unblocks, what it costs,
  what happens if it slips. "It is important" is not a reason.
- Write like a sharp chief of staff briefing a principal who is short on time:
  direct, concrete, no filler, no preamble, no hedging.
- Use British English and £ for currency.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    todaysObjective: {
      type: "string",
      description:
        "One sentence naming what today is actually for. Concrete and specific.",
    },
    reasoning: {
      type: "string",
      description:
        "2-4 sentences explaining the current trajectory: what is moving, what is stuck, what the risk is. Reference specific projects, deals and numbers.",
    },
    recommendedAction: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The action, phrased as an instruction.",
        },
        why: {
          type: "string",
          description:
            "Why this beats every other candidate right now. Reference the leverage mechanism: what it unblocks, its cost, the consequence of delay.",
        },
      },
      required: ["title", "why"],
      additionalProperties: false,
    },
  },
  required: ["todaysObjective", "reasoning", "recommendedAction"],
  additionalProperties: false,
} as const;

interface ReasonerResult {
  todaysObjective: string;
  reasoning: string;
  recommendedAction?: RecommendedAction;
  model?: string;
}

/**
 * Render the computed state as the model's input. Kept as a stable, ordered
 * block so the prompt prefix caches cleanly across recomputes.
 */
function renderState(engine: EngineOutput, memories: Memory[]): string {
  const s = engine.signals;

  const momentum = s.projectMomentum
    .map(
      (m) =>
        `  - ${m.projectName}: score ${m.score} (${m.delta >= 0 ? "+" : ""}${m.delta} vs prior fortnight), ${m.eventsInWindow} events, status ${m.status}`,
    )
    .join("\n");

  const candidates = s.candidates
    .slice(0, 6)
    .map(
      (c, i) =>
        `  ${i + 1}. [leverage ${c.leverage}] ${c.title}\n     ${c.factors.join("; ")}`,
    )
    .join("\n");

  const bottleneck = engine.bottleneck
    ? `  ${engine.bottleneck.title}
  blocking score ${engine.bottleneck.blockingScore}; ${engine.bottleneck.effortHours}h of effort holding ${engine.bottleneck.dependencyCount} downstream item(s):
${engine.bottleneck.blockedItems.map((b) => `    - ${b}`).join("\n")}`
    : "  none identified";

  const waiting = s.waiting.length
    ? s.waiting
        .map(
          (w) =>
            `  - ${w.title} — waiting on ${w.waitingOn} for ${w.daysWaiting}d${w.overdue ? " (OVERDUE)" : ""}`,
        )
        .join("\n")
    : "  none";

  const stale = s.staleOpportunities.length
    ? s.staleOpportunities
        .map(
          (o) =>
            `  - ${o.name}: ${o.currency} ${o.value.toLocaleString()} at ${Math.round(o.probability * 100)}%, stage ${o.stage}, last contact ${o.lastContactAt ? new Date(o.lastContactAt).toLocaleDateString("en-GB") : "never"}`,
        )
        .join("\n")
    : "  none";

  const memoryBlock = memories.length
    ? memories.map((m) => `  - [${m.kind}] ${m.content}`).join("\n")
    : "  none retrieved";

  return `## Trajectory
direction: ${engine.trajectory}
risk: ${engine.riskLevel}${engine.riskFactors.length ? ` — ${engine.riskFactors.join("; ")}` : ""}
commercial momentum: ${engine.commercialMomentum} (delta ${s.commercialDelta})
events in last 24h: ${s.eventsLast24h}
overdue commitments: ${s.overdueCount}

## Project momentum
${momentum || "  no active projects"}

## Current bottleneck
${bottleneck}

## Ranked candidates (highest leverage first — the top one IS the recommendation)
${candidates || "  none"}

## Waiting on others
${waiting}

## Opportunities past their reply window
${stale}

## Relevant long-term memory
${memoryBlock}`;
}

/**
 * Deterministic fallback.
 *
 * Used when no API key is configured, and when the model call fails. Trajectory
 * must still produce a defensible recommendation without Claude — it just says
 * it more mechanically.
 */
export function deterministicNarrative(engine: EngineOutput): ReasonerResult {
  const top = engine.signals.candidates[0];
  const b = engine.bottleneck;

  const parts: string[] = [];
  parts.push(`Trajectory is ${engine.trajectory} with ${engine.riskLevel} risk.`);

  const hot = engine.signals.projectMomentum.filter((m) => m.status === "hot");
  const stalled = engine.signals.projectMomentum.filter((m) => m.status === "stalled");
  if (hot.length) parts.push(`${hot.map((m) => m.projectName).join(" and ")} moving well.`);
  if (stalled.length)
    parts.push(`${stalled.map((m) => m.projectName).join(" and ")} stalled.`);
  if (engine.riskFactors.length) parts.push(`Risk drivers: ${engine.riskFactors.join("; ")}.`);

  // When the top candidate is not the bottleneck, say why it still goes first —
  // otherwise the objective and the recommendation look like they disagree.
  let why = "";
  if (top && b && b.id === top.id) {
    why = `Highest leverage at ${top.leverage}. ${top.effortHours}h of work releases ${b.dependencyCount} blocked item(s): ${b.blockedItems.slice(0, 3).join(", ")}. Nothing downstream moves until it does.`;
  } else if (top && b) {
    why = `Highest leverage at ${top.leverage}: ${top.factors.join("; ")}. It goes before the bottleneck because it is time-critical and costs ${top.effortHours}h against the bottleneck's ${b.effortHours}h — do it first, then spend the day on ${b.title}.`;
  } else if (top) {
    why = `Highest leverage at ${top.leverage}. ${top.factors.join("; ")}.`;
  }

  return {
    todaysObjective: engine.todaysObjective,
    reasoning: parts.join(" "),
    recommendedAction: top
      ? {
          title: top.title,
          why,
          leverage: top.leverage,
          candidateId: top.id,
          tier: top.kind === "opportunity" ? "draft" : "recommend",
        }
      : undefined,
  };
}

export async function synthesise(
  engine: EngineOutput,
  memories: Memory[],
): Promise<ReasonerResult> {
  const fallback = deterministicNarrative(engine);
  if (!hasClaude()) return fallback;

  const top = engine.signals.candidates[0];

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const response = await client.messages.create({
      model: config.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Stable prefix — the system prompt does not change between
          // recomputes, so it caches and only the state block is re-read.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `${renderState(engine, memories)}

Produce today's objective, the trajectory reasoning, and the recommended action.`,
        },
      ],
    });

    // Safety classifiers can decline; check before reading content.
    if (response.stop_reason === "refusal") return fallback;

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return fallback;

    const parsed = JSON.parse(text.text) as {
      todaysObjective: string;
      reasoning: string;
      recommendedAction: { title: string; why: string };
    };

    return {
      todaysObjective: parsed.todaysObjective,
      reasoning: parsed.reasoning,
      recommendedAction: top
        ? {
            title: parsed.recommendedAction.title,
            why: parsed.recommendedAction.why,
            leverage: top.leverage,
            candidateId: top.id,
            tier: top.kind === "opportunity" ? "draft" : "recommend",
          }
        : undefined,
      model: response.model,
    };
  } catch (err) {
    console.error("[trajectory] reasoner failed, using deterministic narrative:", err);
    return fallback;
  }
}
