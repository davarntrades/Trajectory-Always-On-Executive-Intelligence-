/** Provider-neutral narrative synthesis over the deterministic state engine. */

import { config } from "@/lib/config";
import {
  resolveProvider,
  type ProviderId,
  type ProviderPreference,
} from "@/lib/providers";
import type { EngineOutput } from "@/lib/state/engine";
import type { Memory, RecommendedAction } from "@/lib/types";

function systemPrompt(ownerName = config.ownerName) {
  return `You are Trajectory, ${ownerName}'s executive chief of staff.

You are not a chatbot. You help ${ownerName} influence the future through better actions.
The deterministic engine has already computed momentum, risk, bottlenecks and the ranked action list.
Explain that state; never replace or reorder it.

Rules:
- The recommended action is the top-ranked candidate. Do not substitute your own.
- Every claim must trace to a supplied number or memory. Never invent facts, dates, names or figures.
- Give one recommendation, not a menu.
- Explain the mechanism: what it unblocks, its cost and the consequence of delay.
- If user input is supplied, answer it through the computed state without abandoning the ranked action.
- Write like a sharp chief of staff: direct, concrete, concise, British English and £ for currency.`;
}

interface ReasonerResult {
  todaysObjective: string;
  reasoning: string;
  recommendedAction?: RecommendedAction;
  provider?: ProviderId;
  model?: string;
}

export interface SynthesisOptions {
  provider?: ProviderPreference;
  userInput?: string;
  conversationContext?: string;
  ownerName?: string;
}

function renderState(engine: EngineOutput, memories: Memory[]): string {
  const s = engine.signals;
  const momentum = s.projectMomentum
    .map((m) => `- ${m.projectName}: ${m.score}, delta ${m.delta}, ${m.eventsInWindow} events, ${m.status}`)
    .join("\n");
  const candidates = s.candidates
    .slice(0, 6)
    .map((candidate, index) =>
      `${index + 1}. [leverage ${candidate.leverage}] ${candidate.title}\n   ${candidate.factors.join("; ")}`,
    )
    .join("\n");
  const bottleneck = engine.bottleneck
    ? `${engine.bottleneck.title}; score ${engine.bottleneck.blockingScore}; ${engine.bottleneck.effortHours}h; blocks ${engine.bottleneck.blockedItems.join(", ")}`
    : "none identified";
  const waiting = s.waiting.length
    ? s.waiting.map((item) => `- ${item.title}: ${item.daysWaiting}d waiting on ${item.waitingOn}${item.overdue ? " (overdue)" : ""}`).join("\n")
    : "none";
  const memoryBlock = memories.length
    ? memories.map((memory) => `- [${memory.kind}] ${memory.content}`).join("\n")
    : "none";

  return `## Computed trajectory
direction: ${engine.trajectory}
risk: ${engine.riskLevel}${engine.riskFactors.length ? ` — ${engine.riskFactors.join("; ")}` : ""}
commercial momentum: ${engine.commercialMomentum} (delta ${s.commercialDelta})
events last 24h: ${s.eventsLast24h}
overdue commitments: ${s.overdueCount}

## Project momentum
${momentum || "none"}

## Bottleneck
${bottleneck}

## Ranked candidates — candidate 1 is mandatory
${candidates || "none"}

## Waiting
${waiting}

## Relevant memory
${memoryBlock}`;
}

export function deterministicNarrative(engine: EngineOutput): ReasonerResult {
  const top = engine.signals.candidates[0];
  const bottleneck = engine.bottleneck;
  const parts = [`Trajectory is ${engine.trajectory} with ${engine.riskLevel} risk.`];
  if (engine.riskFactors.length) parts.push(`Risk drivers: ${engine.riskFactors.join("; ")}.`);

  const why = top
    ? bottleneck?.id === top.id
      ? `Highest leverage at ${top.leverage}. ${top.effortHours}h releases ${bottleneck.dependencyCount} blocked item(s): ${bottleneck.blockedItems.slice(0, 3).join(", ")}.`
      : `Highest leverage at ${top.leverage}. ${top.factors.join("; ")}.`
    : "";

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
  options: SynthesisOptions = {},
): Promise<ReasonerResult> {
  const fallback = deterministicNarrative(engine);
  let provider;
  try {
    provider = resolveProvider(options.provider);
  } catch (error) {
    throw error;
  }
  if (!provider) return fallback;

  const top = engine.signals.candidates[0];
  const userContext = options.userInput?.trim()
    ? `\n\n## User input\n${options.userInput.trim()}`
    : "";
  const conversationContext = options.conversationContext?.trim()
    ? `\n\n## Recent conversation memory\n${options.conversationContext.trim()}`
    : "";

  try {
    const response = await provider.generate({
      systemPrompt: systemPrompt(options.ownerName),
      prompt: `${renderState(engine, memories)}${conversationContext}${userContext}\n\nReturn today's objective, concise trajectory reasoning and the mandatory top-ranked action.`,
    });

    return {
      todaysObjective: response.narrative.todaysObjective,
      reasoning: response.narrative.reasoning,
      recommendedAction: top
        ? {
            title: response.narrative.recommendedAction.title,
            why: response.narrative.recommendedAction.why,
            leverage: top.leverage,
            candidateId: top.id,
            tier: top.kind === "opportunity" ? "draft" : "recommend",
          }
        : undefined,
      provider: provider.id,
      model: response.model,
    };
  } catch (error) {
    console.error(`[trajectory] ${provider.id} reasoner failed:`, error);
    if (options.provider && options.provider !== "auto") throw error;
    return fallback;
  }
}
