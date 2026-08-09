# Trajectory

Persistent executive intelligence. Not a chatbot.

Trajectory continuously observes, remembers, reasons, recommends and — when
authorised — acts. It maintains one computed state of what is moving, what is
stuck, and what the highest-leverage next action is, and it explains why.

See [`ROADMAP.md`](./ROADMAP.md) for the architecture and the full phase plan.
Current product progress, completed milestones, blockers and the next recommended
milestone are maintained in [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md).

---

## The core idea

Most assistants ask an LLM to work out what matters on every message. That can't
hold state, can't be audited, and gives different answers to the same question on
consecutive days.

Trajectory splits reasoning in two:

| Layer | Owner | Responsibility |
|---|---|---|
| **State engine** | TypeScript, pure functions | Computes momentum, bottleneck, leverage, risk from data with explicit formulas |
| **Reasoner** | Provider adapter | Explains the computed state — it never decides it |

The selected provider receives a **ranked, scored candidate set** and explains the top one. It
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
| `OPENAI_API_KEY` | Enables OpenAI as a selectable server-side reasoning provider |
| `VOYAGE_API_KEY` | Semantic memory retrieval (the Claude API has no embeddings endpoint) |
| Supabase vars | Per-user authentication, persistent memory, conversations and audit history |
| `TRAJECTORY_AUTH_ENABLED=false` | Optional incident kill switch for an otherwise complete Supabase environment |
| Connector OAuth variables | Per-user connect/disconnect, health and sync lifecycle |

The interface footer shows which mode you are in.

### Intelligence providers

Trajectory's state engine remains deterministic and provider-independent. Claude,
OpenAI, Gemini, Grok and local OpenAI-compatible models are adapters used only to explain the already-ranked state and answer
spoken input through that state. The provider can be selected from the compact
control in the application header for the current session.

Provider credentials are read only in server modules and are never returned by
the provider metadata or briefing APIs. Configure `ANTHROPIC_API_KEY` and/or
`OPENAI_API_KEY`, `GEMINI_API_KEY` and/or `XAI_API_KEY` in Vercel. Optional model variables and
`TRAJECTORY_DEFAULT_PROVIDER` variables override the defaults.

`GET /api/providers` returns safe availability/model metadata. A spoken request
is sent to `POST /api/voice/brief` with the transcript and selected provider;
the response includes only the generated briefing and provider/model identity.

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
| `GET /api/providers` | Safe provider availability and model metadata |
| `POST /api/voice/brief` | Generate and persist a provider-backed voice interaction |
| `GET/POST /api/conversations` | Load or create user-owned conversations |
| `GET/POST /api/conversations/:id/messages` | Load or append isolated conversation messages |
| `GET/POST/PATCH /api/goals` | Read and update goals |
| `GET /api/briefs` | Read the authenticated user’s brief archive |
| `GET /api/trajectory/history` | Read historical trajectory changes |
| `GET/PATCH /api/settings` | Read or update provider and workspace settings |
| `GET /api/connectors` | Safe connector status; never returns credentials |
| `GET /api/connectors/:id/connect` | Begin a user-bound OAuth flow |
| `DELETE /api/connectors/:id` | Disconnect and erase stored credentials |
| `POST /api/connectors/:id/sync` | Run connector credential/health synchronization |
| `GET /api/cron/intelligence` | Vercel Cron executive-signal refresh; requires `CRON_SECRET` |
| `GET /api/work-items` | Canonical work board: active priority, next open, blocked, recently completed |
| `POST /api/work-items` | Create a manual launch task |
| `PATCH /api/work-items` | Change a work item's status, or promote it to the active priority |
| `POST /api/work-items/sync` | Ingest current GitHub issues and pull requests |

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

Trajectory uses the Next.js App Router and Vercel Git integration. `vercel.json`
defines the daily background-intelligence schedule; no custom build output is required.

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

4. **Configure environment variables.** In the import screen, add the required
   variables from `.env.example` to the **Production** environment:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the legacy
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CONNECTOR_ENCRYPTION_KEY`
   - `CRON_SECRET`
   - at least one provider API key
   - `GITHUB_INGESTION_TOKEN` and `GITHUB_INGESTION_REPOSITORY` (optional) to
     ingest open work from GitHub. The token needs read-only repository scope;
     nothing in this path writes to GitHub. Without them the launch backlog
     still works for manually created tasks and `/api/work-items/sync` reports
     `503` rather than failing silently.

   Apply every migration in `supabase/migrations/` in filename order to a
   **dedicated Trajectory Supabase project**. Configure email verification plus
   Google and Apple providers in Supabase Auth, and add `/auth/callback` to the
   allowed redirect URLs. Set connector provider callbacks using the paths in
   `.env.example`. Add Optional variables only for the capabilities you intend
   to test. Never expose service, provider, OAuth or encryption secrets with a
   `NEXT_PUBLIC_` prefix.

   Authentication activates automatically when the Supabase URL, browser key
   and service-role key are all present. Use `TRAJECTORY_AUTH_ENABLED=false`
   only as an incident kill switch. Verify signup, verification and reset in
   Preview before promoting new authentication configuration to Production.

5. **Deploy.** Choose **Deploy**. Subsequent pushes to the configured production
   branch create production deployments; other branches receive preview URLs.

6. **Verify the deployment.** Open `/api/health` on the deployed URL and confirm
   it reports `"productionReady": true` and `"store": "supabase"`. Then verify
   signup, email confirmation, sign-in, `/dashboard`, sign-out and password reset.
   Test the orb on both a
   desktop browser and a microphone-capable phone. If environment variables were
   added after a build, redeploy so the new values take effect.

7. **Connect a custom domain (optional).** Open the Vercel project's
   **Settings → Domains**, add the domain, and follow the DNS records Vercel
   provides. Verify the domain after DNS propagation.

### Supabase and OAuth safety

The SaaS migration enforces owner-scoped Row Level Security and creates a profile
and settings row from the Auth user trigger. Connector refresh tokens are
AES-256-GCM encrypted before storage and the credential tables are revoked from
browser roles. Service-role access is limited to request handlers that first
authenticate a user and then filter by that user id, or to the signed cron route.

Google and Apple sign-in still require provider credentials and redirect-domain
configuration in the Supabase dashboard. Apple additionally requires an Apple
Developer Services ID, key and verified domain. These external settings cannot
be supplied by the repository itself.

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
src/lib/providers/          interchangeable Claude, OpenAI, Gemini, Grok and local adapters
src/lib/state/reasoner.ts   provider narrative over the computed state
src/lib/state/compute.ts    orchestration; the single entry point
src/lib/memory/             hybrid retrieval + never-ask-twice
src/lib/connectors/         registry, OAuth lifecycle and encrypted credential boundary
src/lib/permissions.ts      five tiers, two ceilings
src/lib/actions.ts          action pipeline, fully audited
src/lib/store/              Supabase or seed, behind one interface
supabase/migrations/        schema, pgvector, RLS
```

---

## Current production boundary

Authentication, tenant-isolated persistence, provider switching, OAuth account
lifecycle, encrypted credentials, dashboard archives and change-aware scheduled
reasoning are implemented. Vendor-specific connector data ingestion and token
refresh adapters remain intentionally separate from the common framework: the
current sync endpoint validates credential health and records runs but adds no
vendor events yet. Background work is a daily Vercel Cron baseline; higher
frequency or durable retry orchestration should use a queue as usage grows.
