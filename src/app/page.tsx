/**
 * Home.
 *
 * The homepage answers four questions before it offers a conversation:
 * where am I, where am I heading, what is stopping me, what should I do next.
 *
 * Chat is not here. It is one interface into the state engine, not the front
 * door — the state is the product, and it should be readable without typing
 * anything.
 */

import { DecayStrip, StateReadout } from "@/components/dashboard/hero";
import {
  AvailableActionsPanel,
  CommitmentsPanel,
  NotificationsPanel,
  RecentChangesPanel,
  RecentWinsPanel,
  RiskPanel,
  WhyPanel,
} from "@/components/dashboard/loop-panels";
import {
  CalendarPanel,
  GoalsPanel,
  OpportunitiesPanel,
  ProjectsPanel,
  WaitingPanel,
} from "@/components/dashboard/panels";
import { Badge, Panel } from "@/components/ui/panel";
import { VoiceMode } from "@/components/voice/voice-mode";
import { config, runtimeMode } from "@/lib/config";
import { detectChanges } from "@/lib/loop/delta";
import { computeState } from "@/lib/state/compute";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const store = getStore();

  // Capture the prior snapshot *before* recomputing — computeState persists a
  // new one, and the delta is the difference between them.
  const previous = await store.latestSnapshot();
  const state = await computeState({ persist: true });

  const [goals, opportunities, entities, events, calendar, notifications] =
    await Promise.all([
      store.goals(),
      store.opportunities(),
      store.entities(),
      store.events(14),
      store.calendar(),
      store.notifications(20),
    ]);

  const delta = detectChanges(previous, state, events.slice(0, 10));
  const now = new Date(state.computedAt).getTime();
  const mode = runtimeMode();

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-positive shadow-[0_0_10px] shadow-positive/60" />
            <span className="text-sm text-muted">{config.ownerName}</span>
          </div>
          <p className="mt-1 text-xs text-faint">
            Loop last ran{" "}
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

      {/* Where am I · where am I heading · what should I do next */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <StateReadout state={state} />
        <div className="flex flex-col gap-4">
          <WhyPanel state={state} />
          <DecayStrip state={state} />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <RecentChangesPanel delta={delta} />
          <AvailableActionsPanel
            candidates={state.signals.candidates}
            chosenId={state.recommendedAction?.candidateId}
          />
          <GoalsPanel goals={goals} />
        </div>

        {/* What is stopping me */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Blocked items"
            subtitle={`${state.signals.blocked.length} blocked`}
          >
            {state.signals.blocked.length === 0 ? (
              <p className="py-2 text-sm text-faint">Nothing blocked.</p>
            ) : (
              <ul className="space-y-1.5">
                {state.signals.blocked.slice(0, 6).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start gap-2 text-sm text-muted"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-negative" />
                    <span className="min-w-0 truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <WaitingPanel waiting={state.signals.waiting} blocked={[]} />
          <CommitmentsPanel
            commitments={state.signals.outstandingCommitments}
            now={now}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <OpportunitiesPanel
            opportunities={opportunities}
            entities={entities}
            now={now}
          />
          <RecentWinsPanel events={events} />
          <RiskPanel state={state} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <ProjectsPanel state={state} />
          <CalendarPanel entries={calendar} now={now} />
          <NotificationsPanel notifications={notifications} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <VoiceMode />
        </div>
      </div>

      <footer className="mt-8 border-t border-border/60 pt-4 text-[11px] leading-relaxed text-faint">
        The loop runs on meaningful change, not on a timer. Present-tense signals
        are computed deterministically; forward estimates come from simulation
        and carry their calibration status. Trajectory speaks only when the
        trajectory changes.
      </footer>
    </main>
  );
}
