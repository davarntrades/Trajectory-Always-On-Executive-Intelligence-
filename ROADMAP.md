# Trajectory — Implementation Roadmap

> Trajectory exists to help Davarn influence the future through better actions.
> It does not exist to chat. It observes, remembers, reasons, recommends, and — when
> authorised — acts.

This document is the build plan. It defines the architecture, the phases, and the
design decisions that make Trajectory a persistent executive intelligence rather than
a chat interface with extra panels.

---

## 0. The central design decision

Most "AI assistants" are a chat loop with tool calls. The LLM is asked to figure out
what matters, and it re-derives that judgement from scratch on every message. That
design cannot hold state, cannot be audited, and produces different answers to the
same question on consecutive days.

**Trajectory splits reasoning into two layers:**

| Layer | Owner | Responsibility |
|---|---|---|
| **Deterministic state engine** | TypeScript, pure functions | Computes momentum, bottleneck, leverage scores, risk, waiting/blocked items — from data, with explicit formulas |
| **Narrative synthesis** | Claude (`claude-opus-5`) | Explains *why* the computed state is what it is, in Davarn's language, grounded in the scored inputs |

The consequence: **the recommendation is reproducible and the reasoning is
attributable.** Claude never invents "your bottleneck is X" — it receives a ranked,
scored candidate set and explains the top one. If the recommendation is wrong, you fix
a formula, not a prompt. Every recommendation carries its input signals, so "why did
you say that" is answerable from the record.

This is also what makes the audit trail meaningful. A recommendation is a row with
inputs, scores, model output, and outcome — not an opaque generation.

---

## 1. System architecture

```
                     ┌──────────────────────────────────────────┐
   Connectors ──────▶│  Event Bus (normalised events)           │
   Gmail             │  every observation becomes an Event      │
   Calendar          └───────────────┬──────────────────────────┘
   GitHub                            │
   Notion                            ▼
   Slack             ┌──────────────────────────────────────────┐
   Linear            │  Memory Layer                            │
   Drive             │  episodic · semantic · entity graph      │
   MCP (future)      │  pgvector embeddings + keyword hybrid    │
                     └───────────────┬──────────────────────────┘
                                     │
                                     ▼
                     ┌──────────────────────────────────────────┐
                     │  State Engine  (deterministic)           │
                     │  momentum · bottleneck · leverage        │
                     │  risk · commitments · waiting · blocked  │
                     └───────────────┬──────────────────────────┘
                                     │  scored signals
                                     ▼
                     ┌──────────────────────────────────────────┐
                     │  Reasoner  (claude-opus-5)               │
                     │  narrative · why · recommended action    │
                     └───────────────┬──────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              Dashboard         Voice Mode      Action Pipeline
                                                (permission-gated,
                                                 fully audited)
```

### Why not a chatbot loop

- **Background workers** recompute state on events and on a schedule, not on user input.
- **The dashboard reads state**; it does not generate it. Opening the app is free.
- **Voice reads the same state.** Voice and dashboard can never disagree, because
  there is one state object.
- **Actions are a separate pipeline** with its own permission and audit model.

---

## 2. Data model

Nine core tables (full DDL in `supabase/migrations/`):

| Table | Purpose |
|---|---|
| `entities` | People, companies, projects, tools — the entity graph. Typed, with embeddings. |
| `relationships` | Typed edges between entities (`works_at`, `blocks`, `owns`, `stakeholder_of`) |
| `goals` | What Davarn is trying to make true, with horizon and measurable target |
| `projects` | Active workstreams, linked to goals, with status and momentum history |
| `tasks` | Atomic actions. Carry `effort`, `impact`, `blocked_by`, `waiting_on`, `due` |
| `opportunities` | Commercial pipeline: stage, value, last contact, expected response window |
| `events` | Append-only observation log from connectors. The source of truth for momentum. |
| `memories` | Episodic + semantic memory with `pgvector` embeddings and decay-weighted salience |
| `state_snapshots` | Every computed state, immutable, with the signals that produced it |
| `actions` | Every action Trajectory took or proposed, with tier, approval, and outcome |

`events` and `state_snapshots` are append-only. You can replay any day and see exactly
what Trajectory knew and why it said what it said.

---

## 3. The state engine

Deterministic. Every output carries the inputs that produced it.

### Project momentum
Exponentially decayed, type-weighted event count over a trailing window:

```
momentum(p) = Σ  weight(e.type) · exp(-λ · age_days(e))
             e ∈ events(p)
```

Weights encode that a merged PR means more than a comment. λ is tuned so a project
silent for two weeks reads as stalled.

### Commercial momentum
Value-weighted stage progression minus response latency penalty. An opportunity that
advanced a stage adds; one that has gone quiet past its expected response window
subtracts.

### Bottleneck detection
The bottleneck is the item with the most downstream value blocked behind it:

```
blocking_score(x) = downstream_value(x) · age_factor(x) · dependency_count(x)
                    ─────────────────────────────────────────────────────────
                                        effort(x)
```

`downstream_value` walks the dependency graph and sums the value of everything that
cannot move until `x` moves. This is why the bottleneck is often *not* the most urgent
item — it is the cheapest unlock of the most value.

### Highest-leverage action
Candidates are every unblocked task, every stale opportunity needing follow-up, and
every action that would clear the current bottleneck:

```
leverage(a) = (impact(a) · urgency(a) · unblock_factor(a)) / effort(a)
```

`urgency` incorporates deadline proximity and, for opportunities, buying-cycle
position — the reason "follow up with Company X before noon" is a real recommendation
and not a platitude.

### Risk level
Aggregate of overdue commitments, stalled high-value opportunities, deadline pressure,
and blocked-item age. Banded to `low | elevated | high | critical`.

**Only after all of this runs** does Claude get called — with the scored candidate set,
the current state, and retrieved memory — to produce the narrative and the `why`.

---

## 4. Memory

Memory is not a transcript. Three kinds, one retrieval path:

- **Episodic** — what happened, when, who was involved. Written from events.
- **Semantic** — durable facts. "Healthcare prospect's procurement cycle is 6 weeks."
- **Entity graph** — people, companies, projects and their typed relationships.

**Retrieval** is hybrid: pgvector cosine similarity over embeddings, plus keyword
match, plus entity-graph expansion (pull in memory about entities mentioned in the
query), re-ranked by recency-decayed salience.

**The never-ask-twice rule.** Before Trajectory asks for information, it queries
memory. Anything above the confidence threshold is used silently. Enforced in the
retrieval layer, not left to prompt discipline.

---

## 5. Permissions

Five tiers, ascending. Every action declares its tier; the policy engine decides
whether it proceeds.

| Tier | Meaning | Example |
|---|---|---|
| `observe` | Read only, no side effects | Ingest an email |
| `recommend` | Surface a suggestion | "Follow up with Company X" |
| `draft` | Compose but do not send | Draft the follow-up email |
| `approve` | Queue for explicit approval | Hold the drafted email pending sign-off |
| `execute` | Act autonomously | Send it |

Policies are per capability, per connector. Default is `recommend`. `execute` is opt-in
per capability and never inherited.

**Every action writes an audit row** — proposed, approved, executed, or rejected —
with the state snapshot that motivated it. Nothing Trajectory does is unattributable.

> **Future integration:** `Morrison-Runtime-Governance` provides an admissibility and
> trajectory-verification engine already built for exactly this gate. Wiring it in as
> the policy evaluator for the `execute` tier is a Phase 4 item — it would give
> Trajectory formal admissibility checks on autonomous actions rather than rule
> matching.

---

## 6. Connectors

Modular. A connector implements one interface and registers itself; nothing else in
the system knows which connectors exist.

```ts
interface Connector {
  id: string
  capabilities: Capability[]      // what it can read and do
  sync(ctx): Promise<RawEvent[]>  // pull since last cursor
  normalize(raw): TrajectoryEvent // map to the shared event shape
  actions?: ConnectorAction[]     // permission-gated side effects
}
```

Adding Slack means adding one file. The state engine, memory, and dashboard need no
changes — they consume normalised events. MCP servers plug in as a connector type
whose capabilities are discovered at runtime rather than declared.

---

## 7. Delivery phases

### Phase 1 — Foundation *(this repo, now)*
Schema, memory layer, deterministic state engine, Claude reasoner, connector registry,
permission + audit model, home dashboard, voice scaffold. **Runs end-to-end on seed
data with no credentials**, so the engine is verifiable before any OAuth is wired.

### Phase 2 — Live connectors
Gmail, Google Calendar, GitHub, Notion with real OAuth. Token vault, incremental sync
cursors, webhook receivers where available and polling where not.

### Phase 3 — Autonomy
Background workers on a queue. Event-triggered state recomputation. Proactive
surfacing — Trajectory tells you something changed rather than waiting to be asked.
Draft-tier actions go live.

### Phase 4 — Real-time voice
Full duplex, barge-in, sub-second turn latency. Proactive morning brief. Voice becomes
the primary interface; the dashboard becomes the audit surface. Morrison governance
engine wired into the `execute` gate.

### Phase 5 — Executive OS
Multi-agent decomposition for research and analysis. Simulation: "if I do X, what does
the trajectory look like in 6 weeks." Slack, Linear, Drive, arbitrary MCP servers.
24/7 operation.

---

## 8. What Phase 1 deliberately does not do

Stated plainly so the scope is honest:

- **No live OAuth.** Connectors are real interfaces with seeded adapters. Phase 2.
- **No background worker daemon.** The recompute path is built and callable via API;
  putting it on a queue with retries is Phase 3.
- **Voice is a scaffold, not full duplex.** The session route, state briefing, and
  barge-in-capable client shell exist. Real-time bidirectional audio needs a streaming
  speech provider — Phase 4.
- **Embeddings degrade gracefully.** With no API key, retrieval falls back to keyword +
  entity-graph. Semantics arrive with the key.

Everything else in the brief — memory, state engine, dashboard, permissions, audit,
connector modularity — is implemented and runnable now.
