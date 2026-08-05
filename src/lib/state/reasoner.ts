/** Provider-neutral narrative synthesis over the deterministic state engine. */
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { config } from "@/lib/config";
import { resolveProvider, type ProviderId, type ProviderPreference } from "@/lib/providers";
import type { EngineOutput } from "@/lib/state/engine";
import type { Memory, RecommendedAction } from "@/lib/types";

function systemPrompt(ownerName = config.ownerName) {
  return `You are Trajectory, ${ownerName}'s persistent executive intelligence.

Observe the evolving system and help ${ownerName} influence the future through better actions.
The deterministic engine has already computed momentum, risk, constraints and the ranked action list.
Interpret that state; never replace or reorder it.

Product language:
- Use "${language.headings.executiveSignal}", "${language.headings.highestLeverageAction}", "${language.headings.currentState}", "${language.headings.currentDynamics}", "${language.headings.expectedShift}" and "${language.headings.trajectoryLogic}".
- Do not describe internal model activity or present Trajectory as a generic helper.

Rules:
- The highest-leverage action is the top-ranked candidate. Do not substitute your own.
- Every claim must trace to a supplied number or preserved observation. Never invent facts, dates, names or figures.
- Give one action, not a menu.
- Explain the mechanism: what it unblocks, its cost and the consequence of delay.
- When user input is supplied, respond through the computed state without abandoning the ranked action.
- Write with executive clarity: direct, concrete, concise, British English and £ for currency.`;
}

interface ReasonerResult { todaysObjective: string; reasoning: string; recommendedAction?: RecommendedAction; provider?: ProviderId; model?: string }
export interface SynthesisOptions { provider?: ProviderPreference; userInput?: string; conversationContext?: string; ownerName?: string }

function renderState(engine: EngineOutput, memories: Memory[]): string {
  const signals = engine.signals;
  const momentum = signals.projectMomentum.map((item) => `- ${item.projectName}: ${item.score}, delta ${item.delta}, ${item.eventsInWindow} events, ${item.status}`).join("\n");
  const candidates = signals.candidates.slice(0, 6).map((candidate, index) => `${index + 1}. [leverage ${candidate.leverage}] ${candidate.title}\n   ${candidate.factors.join("; ")}`).join("\n");
  const bottleneck = engine.bottleneck ? `${engine.bottleneck.title}; score ${engine.bottleneck.blockingScore}; ${engine.bottleneck.effortHours}h; blocks ${engine.bottleneck.blockedItems.join(", ")}` : "none identified";
  const waiting = signals.waiting.length ? signals.waiting.map((item) => `- ${item.title}: ${item.daysWaiting}d waiting on ${item.waitingOn}${item.overdue ? " (overdue)" : ""}`).join("\n") : "none";
  const memoryBlock = memories.length ? memories.map((memory) => `- [${memory.kind}] ${memory.content}`).join("\n") : "none";
  return `## ${language.headings.currentState}\ndirection: ${engine.trajectory}\nrisk: ${engine.riskLevel}${engine.riskFactors.length ? ` — ${engine.riskFactors.join("; ")}` : ""}\ncommercial momentum: ${engine.commercialMomentum} (delta ${signals.commercialDelta})\nevents last 24h: ${signals.eventsLast24h}\noverdue commitments: ${signals.overdueCount}\n\n## Project momentum\n${momentum || "none"}\n\n## ${language.headings.currentDynamics}\n${bottleneck}\n\n## Ranked actions — action 1 is mandatory\n${candidates || "none"}\n\n## Waiting\n${waiting}\n\n## Preserved observations\n${memoryBlock}`;
}

export function deterministicNarrative(engine: EngineOutput): ReasonerResult {
  const top = engine.signals.candidates[0];
  const bottleneck = engine.bottleneck;
  const parts: string[] = [engine.trajectory === "accelerating" ? language.trajectory.accelerating : engine.trajectory === "steady" ? language.trajectory.steady : engine.trajectory === "slipping" ? language.trajectory.slipping : language.trajectory.stalled];
  if (engine.riskFactors.length) parts.push(`Risk drivers: ${engine.riskFactors.join("; ")}.`);
  const why = top ? bottleneck?.id === top.id ? `Leverage ${top.leverage}. ${top.effortHours}h releases ${bottleneck.dependencyCount} blocked item(s): ${bottleneck.blockedItems.slice(0, 3).join(", ")}.` : `Leverage ${top.leverage}. ${top.factors.join("; ")}.` : "";
  return { todaysObjective: engine.todaysObjective, reasoning: parts.join(" "), recommendedAction: top ? { title: top.title, why, leverage: top.leverage, candidateId: top.id, tier: top.kind === "opportunity" ? "draft" : "recommend" } : undefined };
}

export async function synthesise(engine: EngineOutput, memories: Memory[], options: SynthesisOptions = {}): Promise<ReasonerResult> {
  const fallback = deterministicNarrative(engine);
  const provider = resolveProvider(options.provider);
  if (!provider) return fallback;
  const top = engine.signals.candidates[0];
  const userContext = options.userInput?.trim() ? `\n\n## User observation\n${options.userInput.trim()}` : "";
  const continuityContext = options.conversationContext?.trim() ? `\n\n## Recent continuity\n${options.conversationContext.trim()}` : "";
  try {
    const response = await provider.generate({
      systemPrompt: systemPrompt(options.ownerName),
      prompt: `${renderState(engine, memories)}${continuityContext}${userContext}\n\nReturn today's objective, concise ${language.headings.trajectoryLogic.toLowerCase()} and the mandatory top-ranked action.`,
    });
    return { todaysObjective: response.narrative.todaysObjective, reasoning: response.narrative.reasoning, recommendedAction: top ? { title: response.narrative.recommendedAction.title, why: response.narrative.recommendedAction.why, leverage: top.leverage, candidateId: top.id, tier: top.kind === "opportunity" ? "draft" : "recommend" } : undefined, provider: provider.id, model: response.model };
  } catch (error) {
    console.error(`[trajectory] ${provider.id} synthesis failed:`, error);
    if (options.provider && options.provider !== "auto") throw error;
    return fallback;
  }
}
