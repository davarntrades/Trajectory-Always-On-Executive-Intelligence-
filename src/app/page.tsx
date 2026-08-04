/**
 * Home dashboard.
 *
 * A server component: state is computed on the server and rendered. Opening the
 * dashboard does not start a conversation — it reads the state the engine
 * already holds.
 */

import { DecisionPanel, SignalStrip } from "@/components/dashboard/decision";
import {
  CalendarPanel,
  ConnectorsPanel,
  GithubPanel,
  GoalsPanel,
  MailPanel,
  NotionPanel,
  OpportunitiesPanel,
  PrioritiesPanel,
  ProjectsPanel,
  TasksPanel,
  WaitingPanel,
} from "@/components/dashboard/panels";
import { Badge } from "@/components/ui/panel";
import { VoiceMode } from "@/components/voice/voice-mode";
import { config, runtimeMode } from "@/lib/config";
import { allConnectors } from "@/lib/connectors";
import { computeState } from "@/lib/state/compute";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const store = getStore();

  const [state, goals, tasks, opportunities, entities, events, calendar] =
    await Promise.all([
      computeState({ persist: true }),
      store.goals(),
      store.tasks(),
      store.opportunities(),
      store.entities(),
      store.events(14),
      store.calendar(),
    ]);

  // "Now" is the instant the state was computed, not the instant of render.
  // Deriving it from fetched data keeps the render pure and guarantees every
  // panel is reasoning about the same moment as the engine was.
  const now = new Date(state.computedAt).getTime();
  const mode = runtimeMode();
  const connectors = allConnectors().map((c) => ({
    id: c.id,
    name: c.name,
    configured: c.isConfigured(),
    capabilities: c.capabilities.map((cap) => ({
      id: cap.id,
      maxTier: cap.maxTier as string,
    })),
  }));

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-positive shadow-[0_0_10px] shadow-positive/60" />
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Trajectory
            </h1>
            <span className="text-sm text-faint">· {config.ownerName}</span>
          </div>
          <p className="mt-1 text-xs text-faint">
            Computed{" "}
            {new Date(state.computedAt).toLocaleString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              day: "numeric",
              month: "short",
              timeZone: config.timezone,
            })}
            {state.model ? ` · ${state.model}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={mode.store === "supabase" ? "positive" : "neutral"}>
            store: {mode.store}
          </Badge>
          <Badge tone={mode.reasoning === "claude" ? "accent" : "neutral"}>
            reasoning: {mode.reasoning}
          </Badge>
        </div>
      </header>

      <div className="space-y-4">
        <DecisionPanel state={state} />
        <SignalStrip state={state} />

        <div className="grid gap-4 lg:grid-cols-3">
          <PrioritiesPanel candidates={state.signals.candidates} />
          <ProjectsPanel state={state} />
          <OpportunitiesPanel
            opportunities={opportunities}
            entities={entities}
            now={now}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <CalendarPanel entries={calendar} now={now} />
          <TasksPanel tasks={tasks} now={now} />
          <WaitingPanel
            waiting={state.signals.waiting}
            blocked={state.signals.blocked}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <MailPanel events={events} />
          <GithubPanel events={events} />
          <NotionPanel events={events} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <GoalsPanel goals={goals} />
          <ConnectorsPanel connectors={connectors} />
          <VoiceMode />
        </div>
      </div>

      <footer className="mt-8 border-t border-border/60 pt-4 text-[11px] leading-relaxed text-faint">
        Momentum, bottleneck and leverage are computed deterministically by the
        state engine; the narrative explains those numbers rather than producing
        them. Every recommendation is reproducible from the signals that
        generated it.
      </footer>
    </main>
  );
}
