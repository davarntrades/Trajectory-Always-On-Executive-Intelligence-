# Trajectory Development Status

> Authoritative living record of Trajectory's product progress, engineering
> milestones, verification history and next recommended milestone.
>
> Last updated: 4 August 2026

## Vision

Trajectory is a persistent executive intelligence that lives alongside the
user's future. It continuously observes the user's chosen world, preserves
context over time, reasons about direction and constraints, and surfaces the
single highest-leverage action. The product should feel less like operating
software and more like reconnecting with an intelligence that has continued
thinking while the user was away.

## Current Production State

### Deployment status

The core Trajectory orb experience is deployed through GitHub and Vercel. The
SaaS foundation was merged through PR #3 into the repository's
production/default branch. Multi-user activation remains feature
gated until a dedicated Trajectory Supabase project and external OAuth settings
are configured.

### Authentication

- Supabase Auth integration for email/password, Google and Apple.
- Email verification, password recovery, secure cookie sessions and sign-out.
- Protected pages and API routes through the Next.js proxy boundary.
- Automatic profile and settings creation for every Auth user.
- Owner-scoped Row Level Security and composite ownership constraints prevent
  cross-workspace conversation access.

### Memory

- Persistent conversations and messages.
- Persistent goals, daily briefs, trajectory history, settings, preferences and
  voice sessions.
- Recent authenticated conversation turns are supplied to subsequent executive
  reasoning calls.
- All stored interactions are attached to an authenticated user.

### AI providers

- Provider-neutral intelligence interface.
- Adapters for Anthropic Claude, OpenAI, Google Gemini and xAI Grok.
- OpenAI-compatible local adapter for Ollama, LM Studio and future local Llama
  deployments.
- Manual provider selection plus Auto routing based on configuration,
  capability, latency and cost characteristics.
- Provider credentials remain server-side and are excluded from browser output.

### Voice

- The existing orb remains the primary voice interaction.
- Listening, thinking and speaking states remain intact.
- Voice transcripts and generated responses are persisted to the user's
  workspace.
- Voice responses use the selected provider and recent conversation context.

### Connectors

- Shared OAuth lifecycle for Google Calendar, Gmail, Outlook, Notion, GitHub and
  Slack.
- Short-lived hashed state, PKCE where supported, scoped permissions, health
  status, connection state, sync history and disconnect handling.
- OAuth credentials are encrypted with AES-256-GCM before database storage.
- Vendor-specific data pull, token refresh and event normalisation remain the
  next connector implementation layer.

### Executive reasoning

- The deterministic state engine remains authoritative for momentum,
  bottlenecks, risk and leverage ranking.
- Providers explain the ranked state rather than replacing it.
- Executive Signal records contain recommendation, rationale, constraint,
  confidence, expected impact, urgency and opportunity cost.
- The existing Executive Signal experience is dynamic and backed by the current
  user-owned state.

### Dashboard

- Authenticated workspace expansion separate from the orb landing experience.
- Provides conversation history, goals, brief archive, connected services,
  provider state, profile/settings, memory, usage and trajectory history.
- Server-rendered request-scoped reads preserve RLS and minimise client work.

### Background intelligence

- Vercel Cron route performs scheduled Executive Signal generation.
- Source fingerprints cover recent events, tasks, goals and opportunities.
- Unchanged input is skipped, avoiding unnecessary provider calls.
- Changed input creates a state snapshot, trajectory history, daily brief,
  provider usage record and Executive Signal.

## Completed Milestones

Completed milestones are append-only. Corrections may be added, but historical
entries must not be removed.

### 4 August 2026 — Trajectory V1 foundation

- **Version or PR:** Commits `6110435` through `cfd4250`
- **Summary:** Established Trajectory as a state-first persistent executive
  intelligence and created the living orb experience.
- **Key achievements:** Persistent domain model, deterministic state engine,
  memory retrieval, trajectory simulation, continuous executive loop, voice
  scaffold and premium orb-centred interface.
- **Verification status:** Repository build and engine implementation completed.

### 4 August 2026 — Production deployment readiness

- **Version or PR:** PR #1, commit `d06e66c`
- **Summary:** Prepared the Next.js application for GitHub-to-Vercel production
  deployment.
- **Key achievements:** Production build configuration, environment template,
  health endpoint, responsive validation checklist and deployment documentation.
- **Verification status:** PR merged; production deployment subsequently
  confirmed operational on Vercel.

### 4 August 2026 — OpenAI provider activation

- **Version or PR:** PR #2, merge commit `7564176`
- **Summary:** Removed the Claude-only application assumption and activated
  OpenAI as a second selectable intelligence provider.
- **Key achievements:** Provider interface, Claude/OpenAI adapters, server-only
  provider selection, safe provider metadata and end-to-end voice routing.
- **Verification status:** ESLint, strict TypeScript, production build and client
  secret scan passed; Vercel preview reported Ready.

### 4 August 2026 — Multi-user SaaS foundation

- **Version or PR:** PR #3
- **Summary:** Evolved Trajectory from a single-user prototype into a modular,
  tenant-isolated SaaS foundation while preserving the existing orb UX.
- **Key achievements:** Supabase Auth flows, tenant schema and RLS, persistent
  workspaces, provider ecosystem, encrypted connector OAuth framework,
  authenticated dashboard, provider usage records and change-aware background
  Executive Signals.
- **Verification status:** ESLint passed with zero warnings; strict TypeScript
  passed; Next.js production build passed; dependency audit found zero known
  vulnerabilities; production HTTP checks passed for home, login, dashboard and
  health routes; client secret-name scan passed. Live multi-user and OAuth tests
  await the dedicated Supabase project and provider configuration.

## Current Architecture

- **Frontend:** Next.js 16 App Router, React 19 and TypeScript. The client-side
  orb component owns microphone and speech animation; authenticated management
  surfaces are server-rendered.
- **Backend:** Next.js Route Handlers and Server Actions. Protected routes use a
  session-refreshing proxy, request-scoped repositories and server-only provider
  or connector modules.
- **Database:** Supabase Postgres. Core operational records use `owner_id`; SaaS
  workspace records use `user_id`. RLS derives identity exclusively from
  `auth.uid()`.
- **Authentication:** Supabase Auth with SSR cookies, email/password, Google,
  Apple, verification, password recovery and automatic profile provisioning.
- **Provider abstraction:** One `IntelligenceProvider` contract with Claude,
  OpenAI, Gemini, Grok and local implementations. Application logic consumes
  structured provider-neutral narratives.
- **Connector framework:** Registry plus per-user OAuth accounts, hashed state,
  PKCE, scoped permissions, AES-256-GCM credentials, health and sync-run records.
- **Executive Signal engine:** Deterministic ranking identifies direction,
  bottleneck and leverage. The selected provider explains the result and the
  complete signal is stored for audit and history.
- **Background jobs:** Signed Vercel Cron endpoint uses service-role access with
  explicit user filters. Fingerprinting provides change detection and provider
  call suppression.
- **Deployment:** GitHub default branch deploys to Vercel. Environment activation
  is staged behind `TRAJECTORY_AUTH_ENABLED` so the existing production orb can
  continue operating until the SaaS database is ready.

## Remaining Work

### Critical

- **Provision a dedicated Trajectory Supabase project.** Apply all migrations in
  filename order and verify the schema independently of other Resurrection Tech
  systems. Expected outcome: a safe database boundary for multi-user activation.
- **Exercise tenant isolation against the live database.** Create two test users
  and prove that conversations, messages, goals, memory, briefs, settings and
  connectors cannot cross tenants. Expected outcome: evidence-backed production
  RLS assurance.
- **Activate authentication in Preview.** Configure environment variables and
  set `TRAJECTORY_AUTH_ENABLED=true` only after migrations succeed. Expected
  outcome: complete signup-to-private-workspace flow without affecting current
  production users.

### High

- **Configure Google OAuth.** Register production/preview domains in Google Cloud
  and Supabase Auth. Expected outcome: Google account creation and sign-in.
- **Configure Apple Sign In.** Provision the Apple Services ID, signing key and
  verified domains. Expected outcome: production Apple authentication.
- **Implement connector token refresh and vendor pull adapters.** Add service API
  clients and normalise records into Trajectory events. Expected outcome: live
  Calendar, Gmail, Outlook, Notion, GitHub and Slack observations.
- **Run live connector isolation tests.** Connect two separate accounts and
  validate encrypted credentials, scopes, refresh, sync and disconnect. Expected
  outcome: per-user connector assurance.

### Medium

- **Add automated integration and RLS tests.** Cover Auth callbacks, API
  ownership, provider switching, connector lifecycle and cron idempotency.
  Expected outcome: repeatable regression protection beyond build checks.
- **Add durable background orchestration.** Move higher-frequency work and retry
  handling to a queue when daily Cron is no longer sufficient. Expected outcome:
  reliable continuous intelligence at growing scale.
- **Complete physical browser verification.** Test account, dashboard, voice and
  safe-area behaviour on iPhone Safari and desktop/mobile Chrome. Expected
  outcome: signed-off device compatibility.
- **Add cost-quality observability.** Capture provider token usage, cost and
  latency alongside the existing usage records. Expected outcome: measurable
  Auto-routing decisions and SaaS cost control.

### Future

- **Expand connector catalogue.** Add Todoist, Linear, Jira, Apple Reminders and
  other executive systems through the standard connector interface.
- **Improve Auto provider routing.** Use measured latency, availability, task
  capability and user budget rather than static characteristics.
- **Add proactive delivery channels.** Deliver approved Executive Signals through
  mobile push, email and calendar-aware brief schedules.
- **Introduce local-first and sovereign deployment options.** Support private
  model endpoints and customer-controlled infrastructure without altering the
  provider contract.

## Known Blockers

- No dedicated Trajectory Supabase project has been confirmed. The connected
  Supabase project appears to serve another production application and must not
  receive Trajectory migrations.
- Google OAuth requires client credentials and redirect configuration.
- Apple Sign In requires Apple Developer configuration and verified domains.
- Live connector testing requires vendor OAuth applications and test accounts.
- The production migration has not yet been applied or verified against a real
  Trajectory database.
- Browser automation was unavailable in the implementation workspace; physical
  Safari and Chrome testing remains outstanding.

## Changelog

Changelog entries are append-only.

### 4 August 2026 — State-first product foundation

- **What changed:** Added the persistent domain model, deterministic engine,
  memory, simulator, continuous loop, voice surface and orb experience.
- **Why:** Establish a reproducible executive intelligence instead of a
  transcript-only chatbot.
- **Verification performed:** Engine and application builds completed throughout
  the milestone sequence.
- **Follow-up:** Production deployment hardening and live provider activation.

### 4 August 2026 — Production deployment and OpenAI

- **What changed:** Prepared the application for Vercel, added health checks and
  documentation, introduced the provider abstraction and enabled OpenAI.
- **Why:** Make Trajectory usable on real devices and remove the Claude-only
  architecture assumption.
- **Verification performed:** PRs #1 and #2 merged; lint, TypeScript, build and
  secret checks passed; Vercel preview reported Ready.
- **Follow-up:** Multi-user identity, persistence and connector foundations.

### 4 August 2026 — SaaS platform foundation

- **What changed:** Added Supabase Auth flows, automatic profiles, RLS tenant
  isolation, persistent user workspaces and APIs, Gemini/Grok/local providers,
  encrypted OAuth connectors, dashboard archives, provider usage and
  change-aware background intelligence.
- **Why:** Move Trajectory from a single-user production prototype toward a
  scalable executive intelligence platform without redesigning the orb.
- **Verification performed:** `npm run check` passed; `npm audit --omit=dev`
  reported zero vulnerabilities; runtime HTTP and client secret scans passed;
  `git diff --check` passed.
- **Follow-up:** Provision the dedicated Supabase project, apply migrations,
  configure external OAuth and conduct two-user isolation tests.

## Engineering Principles

- **State first, not chat first.** Interfaces read a computed executive state;
  providers explain it rather than becoming its source of truth.
- **The orb remains the emotional centre.** Infrastructure may expand without
  turning the primary experience into a conventional dashboard or chatbot.
- **Tenant ownership is structural.** User identifiers, composite ownership
  constraints, RLS and request-scoped clients all enforce isolation.
- **Least privilege by default.** Service-role access is server-only, explicit
  and user-filtered. Connector permissions cannot exceed declared scopes.
- **Secrets never cross the browser boundary.** Model keys, OAuth secrets,
  refresh tokens, encryption keys and cron credentials remain server-side.
- **Provider and connector implementations are replaceable.** Application logic
  consumes stable contracts so new providers and services require localised
  adapters rather than product-wide refactors.
- **Background work must be change-aware.** Unchanged evidence produces no new
  provider call.
- **Degrade safely.** Feature gates preserve the deployed experience until its
  production dependencies are fully configured and verified.
- **Progress history is append-only.** Completed milestones and changelog entries
  remain visible so future contributors can understand how the system evolved.

## Next Recommended Milestone

**Provision and validate the dedicated Trajectory Supabase Preview environment.**

Apply the full migration set to an isolated project, configure Preview
environment variables, enable authentication only in Preview, create two users
and produce evidence that signup, session persistence, provider settings,
conversation memory and RLS isolation work end to end. This is the highest-impact
next step because it turns the completed application architecture into a safely
testable multi-user platform without risking the existing production orb.
