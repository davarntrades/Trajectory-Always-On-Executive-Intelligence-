# Trajectory — State Engine Architecture

> Trajectory is state-first, not chat-first. There is one executive state.
> Voice, chat, dashboard and mobile notifications are interfaces to it.

## SaaS foundation decision — 2026-08-04

Identity is Supabase Auth and every workspace row carries the authenticated user
id. Browser requests use a fresh cookie-bound Supabase client; Row Level Security
compares ownership with `auth.uid()`. Service-role clients exist only in server
modules for scheduled work and encrypted connector credentials, with an explicit
authorised user-id filter on every operation.

The existing orb remains the primary projection. `/dashboard` is a separate,
authenticated archive and configuration projection; it does not replace or
restructure the orb experience.

Model calls cross `IntelligenceProvider`, never an SDK-specific application
boundary. Auto routing considers required capability, availability, latency and
cost. Claude, OpenAI, Gemini, Grok and local OpenAI-compatible endpoints implement
the same structured narrative contract, and their keys remain server-only.

Connectors cross an OAuth account boundary shared by Google Calendar, Gmail,
Outlook, Notion, GitHub and Slack. OAuth state is hashed, short-lived and
single-use; PKCE is enabled where supported. Credential JSON is AES-256-GCM
encrypted before persistence. The common lifecycle owns connection, permissions,
health, sync history and disconnection; vendor pull/normalisation modules plug
into that lifecycle without changing application routes.

The executive loop hashes user-owned events, tasks, goals and opportunities.
An unchanged hash creates no new provider call. Changed state creates a snapshot,
trajectory-history row, daily brief and Executive Signal from one computation.

This document specifies the persistent state engine. `ROADMAP.md` covers delivery
phases; this covers the thing being delivered.

---

## 1. The inversion, and the one rule

A chat-first system has no state — it has a transcript, and re-derives meaning
from it on every turn. A state-first system inverts that: meaning is computed
once, held, and *read* by every surface.

That gives exactly one architectural rule, and everything else follows from it:

> **No interface may read the substrate. Interfaces read state, and only state.**

If the dashboard can query tasks directly, it can render a picture the voice
brief never saw. Two surfaces then disagree, and the user has to work out which
one is lying. The rule is what makes "voice and dashboard can never disagree" a
structural guarantee rather than a coincidence of timing.

**The current code violates this.** `src/app/page.tsx` calls `computeState()` and
then makes six more store calls; `src/lib/voice/briefing.ts` makes three. Today
they agree because they run in one process at one instant. Under caching, a
queue, or a mobile client reading a snapshot, they would drift. Closing this is
the first structural change (§10).

---

## 2. Three tiers

The nine domains are not peers. They sit in three tiers with strictly one-way
flow.

```
┌─ SUBSTRATE ────────────────────────────────────────────────┐
│  What is true. Stored, mutable, authored by connectors.     │
│                                                            │
│  Events · Memory · Objectives · Projects · People           │
│  Constraints · Opportunities                               │
└───────────────────────────┬────────────────────────────────┘
                            │  pure function of (substrate, now)
                            ▼
┌─ DERIVATION ───────────────────────────────────────────────┐
│  What it means. Computed, never authored, always           │
│  reproducible.                                             │
│                                                            │
│  Current State · Recommended Next Actions                  │
└───────────────────────────┬────────────────────────────────┘
                            │  pure function of (state)
                            ▼
┌─ PROJECTION ───────────────────────────────────────────────┐
│  What to show. Read-only, per-surface shaping.             │
│                                                            │
│  Brief (voice) · Board (dashboard) · Digest (mobile)       │
│  Context (chat)                                            │
└────────────────────────────────────────────────────────────┘
```

Three invariants hold this together:

1. **Derived state is never authored.** Nothing writes to Current State or
   Recommended Next Actions except the engine. They are snapshotted for audit,
   but the snapshot is a *record*, not a source. Delete every snapshot and the
   system loses history, not correctness.
2. **The engine is stateless.** It holds nothing between calls. Persistence lives
   in the substrate. "Persistent state engine" means the *state* persists — the
   engine is a pure function over it.
3. **Flow is one-way.** Projections cannot write. Derivation cannot write to
   substrate. Only connectors, ingestion and explicit user action write.

The payoff: `state(t) = f(substrate_as_of(t), t)`. Any past day can be replayed
exactly, which is what makes "why did you recommend that on Tuesday?" answerable.

---

## 3. The nine domains

### 3.1 Events — the observation log

Append-only. The source of truth for *what happened*. Every connector observation
becomes an event; nothing else may claim something occurred.

Events are never edited or deleted, only superseded. This is what makes momentum
reproducible: recompute over the same window and you get the same number.

De-duplicated on `(source, external_id)`, so replaying a webhook is safe.

### 3.2 Memory — the interpreted residue

Events are raw; memory is what they *mean* and what should outlive them. Five
kinds, already implemented: `episodic`, `semantic`, `decision`, `preference`,
`mistake`.

The distinction that matters: an event says "email sent to Priya on the 26th."
Memory says "Northgate's procurement cannot start until DCB0129 sign-off." One is
a fact about the log; the other is a fact about the world, and it stays true after
the email is forgotten.

Memory is **derived from events but stored, not recomputed** — it is the one
place where interpretation is persisted, because re-deriving it from scratch
would be both expensive and non-deterministic.

### 3.3 Objectives — what the work is for

Goals with a horizon and a measurable target. Every project should ladder to one;
a project that ladders to nothing is a signal, not an error, and the engine
surfaces it as *unattributed effort*.

Objectives supply the `value` term in every downstream score. Change an
objective's priority and the entire recommendation set re-ranks — which is the
correct behaviour and the main lever for steering Trajectory.

### 3.4 Projects — the workstreams

Active bodies of work with a `valueScore`, linked to objectives. Projects are the
unit momentum is measured against, and the unit that carries `downstream_value`
in bottleneck detection.

### 3.5 People — the relationship graph

Not a contact list. People are nodes in a typed graph with companies, projects
and opportunities, carrying behavioural attributes learned from observation:
response latency, decision authority, communication preference, buying-cycle
position.

This is what turns "follow up with Tom" into "follow up with Tom **before noon**,
because Company X closes decisions around day 10 and today is day 4." The
attribute doing that work (`buyingCycleDays`) lives on the entity, is written by
memory, and is read by the urgency function.

### 3.6 Opportunities — commercial reality

Pipeline with stage, value, probability, last contact and an expected reply
window. Distinct from projects because they decay: silence is not neutral on a
deal, and the engine penalises it explicitly.

### 3.7 Constraints — what bounds the possible

**This domain does not exist in the current build. It is the most important
addition.**

Everything else answers *what is worth doing*. Constraints answer *what is
actually available to do*. Without them, the engine will confidently recommend a
six-hour task at 4pm on a day with one free hour — correct on leverage, useless
in practice.

A constraint bounds the admissible set:

| Kind | Bounds | Example |
|---|---|---|
| `temporal` | When work can happen | 90 minutes free before the 4pm call |
| `capacity` | How much work fits | ~6 focused hours/day; one deep-work block |
| `financial` | Spend and runway | 11 months runway; £0 discretionary this quarter |
| `dependency` | Ordering | Pilot cannot start before DCB0129 sign-off |
| `commitment` | Promises made | "Compliance pack to Priya by Thursday" |
| `policy` | What Trajectory may do unattended | `send_email` never autonomous |

Each constraint carries:

```ts
interface Constraint {
  id: string
  kind: ConstraintKind
  binding: "hard" | "soft"        // hard excludes; soft penalises
  scope: { type: "global" | "project" | "opportunity" | "person"; id?: string }
  description: string             // human-readable, shown in the "why"
  /** Evaluated against a candidate. Pure, no I/O. */
  admits(candidate: ScoredCandidate, ctx: ConstraintContext): ConstraintVerdict
  slack?: number                  // 0..1 — how much room is left
  source: "observed" | "declared" | "inferred"
}

interface ConstraintVerdict {
  admissible: boolean
  penalty: number                 // 0..1, applied to leverage when soft
  reason: string                  // always populated, admissible or not
}
```

This changes the recommendation pipeline from *rank* to **filter, then rank**:

```
candidates → constraint filter → admissible set → rank by leverage → primary
```

Two consequences worth stating plainly:

- **Inadmissible candidates are not discarded — they are ranked separately** as
  *blocked by constraint*, with the constraint named. "I would recommend the
  compliance pack, but you have 40 minutes free and it needs six hours" is a more
  useful output than silently promoting something else.
- **Soft constraints penalise rather than exclude**, so the engine degrades
  gracefully instead of returning an empty set when everything is tight.

Constraints also unify a concept currently split: `tasks.blockedBy` is a
dependency constraint expressed as a column, and the permission tier system is a
policy constraint expressed as a separate module. Both should be projected into
the constraint model so there is one admissibility check, not three.

> **This is where `Morrison-Runtime-Governance` belongs.** Its admissibility and
> trajectory-verification engine is precisely a constraint evaluator with formal
> guarantees. `Constraint.admits()` is the seam: policy-kind constraints delegate
> to Morrison, and autonomous execution gets formal admissibility rather than
> rule matching. This is why the interface is a predicate and not a config blob.

### 3.8 Current State — what is true right now

The derived snapshot: trajectory direction, risk level, momentum per project,
commercial momentum, the bottleneck, waiting and blocked items, outstanding
commitments, and constraint pressure.

Immutable and timestamped. Every snapshot stores the signals that produced it, so
a recommendation is auditable after the fact.

### 3.9 Recommended Next Actions — what to do

Note the plural; the current build returns one. The correct model is a **ranked
admissible set with one designated primary**, because different surfaces need
different depth:

- **Voice** wants exactly one. Reading a list aloud is useless.
- **Dashboard** wants five, with scores visible.
- **Chat** wants the set, because "why not the other one?" is a normal question
  and must be answerable without recomputing.
- **Mobile** wants the primary, and only when it *changed*.

One shape serves all four:

```ts
interface RecommendationSet {
  primary?: RecommendedAction        // the single answer
  alternatives: RecommendedAction[]  // ranked, admissible
  excluded: ExcludedAction[]         // inadmissible + which constraint bound them
  computedAt: string
}
```

---

## 4. The state contract

One object. Complete enough that no interface needs the substrate.

```ts
interface ExecutiveState {
  computedAt: string
  version: number                  // schema version, for snapshot replay

  // — derived —
  current: {
    trajectory: TrajectoryDirection
    risk: { level: RiskLevel; score: number; factors: string[] }
    momentum: { projects: MomentumReading[]; commercial: CommercialReading }
    bottleneck?: Bottleneck
    pressure: ConstraintPressure[]   // which constraints are near binding
  }
  recommendations: RecommendationSet

  // — substrate, projected read-only —
  objectives: Objective[]
  projects: ProjectView[]          // project + its momentum, pre-joined
  people: PersonView[]             // person + open threads, pre-joined
  opportunities: OpportunityView[]
  constraints: ConstraintView[]
  commitments: Commitment[]
  waiting: WaitingItem[]
  blocked: BlockedItem[]
  calendar: CalendarEntry[]
  recentEvents: FeedItem[]
  activeMemory: Memory[]           // what was in context for this computation

  // — provenance —
  signals: StateSignals             // every input to every score
  model?: string
}
```

Two deliberate choices:

**Substrate is included, pre-joined, read-only.** The dashboard needs the task
list; if it cannot get it from state it will reach for the store. So state
carries it — as a *view* (`ProjectView` = project + momentum already attached),
not a raw row. Interfaces render; they do not join.

**`activeMemory` is part of state.** What Trajectory recalled when it decided is
part of the decision. Without it, a past recommendation cannot be explained.

---

## 5. Derivation pipeline

Ordered, each stage a pure function:

```
1. load          substrate as of now
2. momentum      events        → project + commercial momentum
3. graph         tasks + deps  → bottleneck, blocked, waiting
4. commitments   tasks + people→ outstanding, overdue
5. constraints   substrate     → active constraint set + slack
6. candidates    everything    → scored candidates (leverage)
7. admissibility candidates    → admissible / excluded  ← the new stage
8. rank          admissible    → RecommendationSet
9. risk          all signals   → level + factors
10. memory       objective     → retrieve relevant + standing
11. synthesis       state + memory→ narrative (Claude)   ← the only impure stage
12. snapshot     state         → append, diff vs previous
```

Stages 1–10 are deterministic and cheap. Stage 11 is the only model call, and the
only one that can fail — it degrades to the deterministic narrative rather than
failing the computation.

---

## 6. Projections

One pure function per surface, `(ExecutiveState) → Projection`. This is the
entire interface layer.

| Projection | Surface | Shape |
|---|---|---|
| `Brief` | Voice | Ordered speech-shaped lines. Primary recommendation only. No markdown, no scores. |
| `Board` | Dashboard | Panel data, scores visible, provenance expandable. |
| `Digest` | Mobile | **Diff-driven** — only what changed past a salience threshold. |
| `Context` | Chat | State rendered as model context + the answerable question set. |

**Chat is not special.** It is a projection plus an intent channel:

- Its *input* context is `Context(state)` — the same state everything else reads.
- Its *outputs* are one of: an answer read from state; a proposal into the
  existing action pipeline (tier-checked, audited); or a substrate write
  (correcting a fact, declaring a constraint) which lands as an event.
- Its transcript writes into Events, and salient turns condense into Memory.

Chat therefore cannot hold private state, cannot bypass permissions, and cannot
know something the dashboard doesn't. That is the property that makes it safe to
build last.

---

## 7. Recompute lifecycle and cost

Recomputing everything on every event calls Claude far too often. Split by cost:

| Trigger | Deterministic (1–10) | Narrative (11) |
|---|---|---|
| Event ingested | always | only if the decision changed |
| Scheduled tick (15 min) | always | only if the decision changed |
| Interface read | cached if fresh (<60s) | never |
| Explicit refresh | always | always |

"The decision changed" means: the primary recommendation, the bottleneck, or the
risk band differs from the last snapshot. Momentum drifting from 5.1 to 5.2 does
not warrant re-narrating.

This keeps model spend proportional to *decisions*, not to *observations* — which
matters when a busy inbox generates hundreds of events a day.

---

## 8. Diffing and proactivity

Mobile notification is not "render state," it is "tell me what changed." That
makes diffability a design requirement, not a feature:

```ts
interface StateDelta {
  from: string; to: string          // snapshot timestamps
  changes: {
    kind: "recommendation_changed" | "bottleneck_cleared" | "risk_escalated"
        | "constraint_binding" | "commitment_due" | "opportunity_stalled"
    salience: number                // 0..1 — the notification threshold
    summary: string
    why: string
  }[]
}
```

Because snapshots are append-only and complete, the delta is a pure function of
two of them. Proactivity — the thing that makes this an assistant rather than a
dashboard — is `diff(previous, current)` filtered by salience. No separate
notification engine, no duplicated rules.

---

## 9. Persistence

| Data | Store | Mutability |
|---|---|---|
| Events | Postgres | Append-only |
| Snapshots | Postgres | Append-only |
| Audit log | Postgres | Append-only |
| Memory | Postgres + pgvector | Append + supersede (never hard delete) |
| Objectives, Projects, People, Opportunities, Constraints | Postgres | Mutable, versioned via events |
| Derived state | — | Never persisted as truth |

Three append-only logs mean the system is fully replayable: what happened, what
Trajectory concluded, and what it did about it.

---

## 10. What this changes in the current build

Honest gap list against what is committed:

| # | Change | Why | Size |
|---|---|---|---|
| 1 | **Close the projection boundary** — remove all 9 direct store reads from `page.tsx` and `briefing.ts`; widen `ExecutiveState` to carry pre-joined views | The one rule; interfaces currently bypass state | Medium |
| 2 | **Add the Constraints domain** — table, model, `admits()`, and the admissibility stage between scoring and ranking | Missing entirely; recommendations are unbounded by reality | Large |
| 3 | **Recommendations become a set** — `primary` + `alternatives` + `excluded` | "Recommended Next Actions" is plural; chat needs the set | Small |
| 4 | **Split recompute cost** — deterministic always, narrative only on decision change | Model spend currently scales with event volume | Small |
| 5 | **Add `StateDelta`** — diff two snapshots, salience-filter | Mobile notifications and proactivity have no basis without it | Medium |
| 6 | **Fold `blockedBy` and permission tiers into constraints** | Three admissibility mechanisms should be one | Medium |
| 7 | **Rename `TrajectoryState` → `ExecutiveState`**, add `version` | It is the executive picture, not just a direction reading; snapshots need schema versioning to stay replayable | Small |

What already matches the design and does not change: the deterministic/narrative
split, event ingestion and de-duplication, the memory model and hybrid retrieval,
the store adapter, the audit trail, and the connector registry.

---

## 11. Build order

Each step leaves the system working.

1. **(7, 3)** State contract — rename, version, recommendation set. Mechanical.
2. **(1)** Projection boundary — widen state, strip store reads from interfaces.
   *After this, the one rule holds and adding a surface is safe.*
3. **(2)** Constraints — schema, model, admissibility stage. The substantive one.
4. **(6)** Fold dependencies and policy into constraints. One admissibility check.
5. **(4)** Cost split.
6. **(5)** `StateDelta` → mobile notifications and proactive surfacing.
7. **Then** the chat interface, as `Context` projection + intent channel.

Chat lands last on purpose. Once steps 1–6 are done it is a thin surface over a
state engine that already knows everything — which is the whole point.
