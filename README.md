# Trajectory

Persistent executive intelligence. Not a chatbot.

Trajectory continuously observes, remembers, reasons, recommends and — when
authorised — acts. It maintains one computed state of what is moving, what is
stuck, and what the highest-leverage next action is, and it explains why.

See [`ROADMAP.md`](./ROADMAP.md) for the architecture and the full phase plan.

---

## The core idea

Most assistants ask an LLM to work out what matters on every message. That can't
hold state, can't be audited, and gives different answers to the same question on
consecutive days.

Trajectory splits reasoning in two:

| Layer | Owner | Responsibility |
|---|---|---|
| **State engine** | TypeScript, pure functions | Computes momentum, bottleneck, leverage, risk from data with explicit formulas |
| **Reasoner** | Claude (`claude-opus-5`) | Explains the computed state — it never decides it |

Claude receives a **ranked, scored candidate set** and explains the top one. It
never invents "your bottleneck is X". So a recommendation is reproducible, and
"why did you say that?" is answerable from the record — every state snapshot
stores the signals that produced it.

If a recommendation is wrong, you fix a formula, not a prompt.

---

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. **No credentials required** — it runs on a seed
dataset so the engine is verifiable before any OAuth exists.

Copy `.env.example` to `.env.local` to unlock more:

| Set this | You get |
|---|---|
| *(nothing)* | Full state engine, dashboard, voice, permissions, audit — on seed data |
| `ANTHROPIC_API_KEY` | Claude-written narrative and reasoning instead of the deterministic fallback |
| `VOYAGE_API_KEY` | Semantic memory retrieval (the Claude API has no embeddings endpoint) |
| Supabase vars | Persistent memory, event log and audit trail across restarts |
| Connector tokens | Live data instead of seed (Phase 2) |

The interface footer shows which mode you are in.

For a production-like local verification, copy the example environment file and
run the same checks used before deployment:

```bash
cp .env.example .env.local
npm run check
npm start
```

The app can still boot without credentials using its deterministic seed mode,
but a production deployment needs all four variables marked **Required** in
`.env.example` to provide Claude reasoning and durable Supabase state.

---

## API

| Route | Purpose |
|---|---|
| `GET /api/state` | Compute and return current state. `?deterministic=1` skips the model |
| `POST /api/events` | Ingest events. Triggers a state recompute — this is the autonomy surface |
| `GET/POST /api/sync` | Connector status / run a sync pass |
| `GET/POST /api/actions` | List actions + audit; propose, decide, execute |
| `GET /api/memory?q=` | Retrieve memory. `&check=1` runs the never-ask-twice check |
| `GET /api/voice/brief` | The spoken briefing |
| `GET /api/health` | Value-free deployment and environment readiness diagnostics |

Ingest an event and watch the state change:

```bash
curl -X POST localhost:3000/api/events -H 'content-type: application/json' -d '{
  "events": [{
    "source": "gmail", "type": "email.received",
    "title": "Re: terms — happy to proceed",
    "externalId": "msg-1", "projectId": "proj-companyx"
  }]
}'
```

Events are de-duplicated on `(source, externalId)`, so replaying a webhook is safe.

---

## Deploying to Vercel

Trajectory uses the Next.js App Router and deploys through Vercel's standard
Git integration. It does not require a `vercel.json` or custom build settings.

1. **Clone the repository.**

   ```bash
   git clone https://github.com/davarntrades/Trajectory-Always-On-Executive-Intelligence-.git
   cd Trajectory-Always-On-Executive-Intelligence-
   npm install
   npm run check
   ```

2. **Connect GitHub to Vercel.** Sign in to Vercel, open **Add New → Project**,
   and connect the GitHub account that can access the repository.

3. **Import the project.** Select the Trajectory repository. Vercel should detect
   **Next.js** automatically. Keep the root directory, build command and output
   settings at their detected defaults.

4. **Configure environment variables.** In the import screen, add the four
   Required variables from `.env.example` to the **Production** environment:

   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

   Apply `supabase/migrations/0001_init.sql` and then `0002_loop.sql` to that
   Supabase project before the first persistent run. Add Optional variables only
   for the capabilities you intend to test. Never expose
   `SUPABASE_SERVICE_ROLE_KEY` with a `NEXT_PUBLIC_` prefix.

5. **Deploy.** Choose **Deploy**. Subsequent pushes to the configured production
   branch create production deployments; other branches receive preview URLs.

6. **Verify the deployment.** Open `/api/health` on the deployed URL and confirm
   it reports `"productionReady": true`, `"store": "supabase"`, and
   `"reasoning": "claude"`. Then load the home screen and test the orb on both a
   desktop browser and a microphone-capable phone. If environment variables were
   added after a build, redeploy so the new values take effect.

7. **Connect a custom domain (optional).** Open the Vercel project's
   **Settings → Domains**, add the domain, and follow the DNS records Vercel
   provides. Verify the domain after DNS propagation.

### Private testing

Trajectory is currently a single-operator build and does not yet implement
end-user authentication. Enable **Vercel Deployment Protection** before using
real personal or business data. Keep production and preview deployments protected
until application authentication is added.

The maintained release gate is in
[`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md).

---

## Permissions

Five ascending tiers: `observe → recommend → draft → approve → execute`.

Two independent ceilings must both allow a tier — the capability's declared
ceiling (in the connector definition, which policy cannot raise) and the owner's
policy (default `recommend`). Requests above the ceiling are **downgraded, not
silently dropped**; undeclared capabilities are **refused**.

Every proposal, downgrade, refusal, approval and execution writes an audit row.

```bash
# Asks for `execute`; policy caps send_email at `approve`.
curl -X POST localhost:3000/api/actions -H 'content-type: application/json' -d '{
  "op":"propose","connectorId":"gmail","capability":"send_email",
  "requestedTier":"execute","summary":"Follow up with Tom"
}'
# -> tier: "approve", status: "awaiting_approval"
```

---

## Layout

```
src/lib/state/engine.ts     deterministic scoring — momentum, bottleneck, leverage, risk
src/lib/state/reasoner.ts   Claude narrative over the computed state
src/lib/state/compute.ts    orchestration; the single entry point
src/lib/memory/             hybrid retrieval + never-ask-twice
src/lib/connectors/         registry; one file per connector
src/lib/permissions.ts      five tiers, two ceilings
src/lib/actions.ts          action pipeline, fully audited
src/lib/store/              Supabase or seed, behind one interface
supabase/migrations/        schema, pgvector, RLS
```

---

## Phase 1 scope

Implemented and runnable: memory, state engine, reasoner, dashboard, permissions,
audit, connector modularity, event ingestion, voice scaffold.

Deliberately not yet done — stated plainly rather than implied:

- **No live OAuth.** Connectors are real interfaces with declared capabilities;
  `pull` is unimplemented until Phase 2.
- **No background daemon.** The recompute path is built and callable; putting it
  on a queue with retries is Phase 3.
- **Voice is a scaffold.** Briefing generation, speech synthesis and barge-in
  work. Real-time full-duplex audio needs a streaming speech provider — Phase 4.
- **Deterministic narrative reads mechanically.** Without `ANTHROPIC_API_KEY` the
  spoken "why" recites scores rather than prose. That is the fallback working as
  designed, not a bug.
