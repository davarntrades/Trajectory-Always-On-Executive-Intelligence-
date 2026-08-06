# Trajectory Development Status

> Authoritative living record of Trajectory's product progress, engineering
> milestones, verification history and next recommended milestone.
>
> Last updated: 6 August 2026

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
production/default branch. The dedicated `trajectory-prod` Supabase project is
healthy, all four production migrations are applied, and a complete Supabase
environment now activates authenticated workspaces automatically. External
Google, Apple and connector OAuth applications remain separately configurable.
The production deployment for PR #4 is Ready on Vercel; Vercel Deployment
Protection currently requires a Vercel session before requests reach the app.

### Authentication

- Supabase Auth integration for email/password, Google and Apple.
- Email verification, password recovery, secure cookie sessions and sign-out.
- Protected pages and API routes through the Next.js proxy boundary.
- Automatic profile and settings creation for every Auth user.
- Owner-scoped Row Level Security and composite ownership constraints prevent
  cross-workspace conversation access.
- Production activation is configuration-driven, with an explicit environment
  kill switch retained for incident response.

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

### Cinematic motion and visual identity

- Shared motion tokens in `src/content/trajectory-motion.ts` govern duration,
  easing, ambient cadence, voice-orb phases and reduced-motion alternatives.
- Reusable celestial primitives in
  `src/components/trajectory/celestial-motion.tsx`: the Trajectory shooting-star
  mark, ambient crossings, the Executive Signal crossing, a celestial loader and
  a constellation success state.
- The shooting-star mark is the sole symbol in the header lockup and beside
  Executive Signal; no generic sparkle or icon-library glyph remains in the
  primary experience.
- The voice orb is enhanced, not replaced, across idle, listening, integrating,
  speaking and settling phases.
- Ambient crossings run on randomised 20–40 second intervals and stop entirely
  when the page is hidden or reduced motion is requested.
- `prefers-reduced-motion` is honoured globally, and no state is communicated by
  motion alone.

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

### 5 August 2026 — Production Supabase activation

- **Version or PR:** PR #4
- **Summary:** Connected Trajectory to its dedicated production Supabase
  boundary and activated the multi-user workspace foundation.
- **Key achievements:** Applied the core, continuous-loop, SaaS and production
  hardening migrations; provisioned 27 RLS-protected tables and policies;
  verified automatic profile/settings creation; proved two-tenant conversation
  and message isolation; removed manual auth activation from the normal deploy
  path; resolved all Supabase security-advisor findings.
- **Verification status:** Migration history confirmed on `trajectory-prod`;
  transactional two-user RLS test passed and rolled back cleanly; security
  advisor returned zero findings; two temporary users obtained password
  sessions, persisted a conversation/message through the Data API and saved an
  OpenAI provider preference; temporary records cascade-deleted cleanly; ESLint,
  strict TypeScript and Next.js production build passed; Vercel production
  deployment reached Ready.

### 6 August 2026 — Cinematic motion integration and visual identity

- **Version or PR:** Branch `agent/cinematic-motion-integration`, continuing
  Issue #8 on top of the merged motion foundation.
- **Summary:** Connected the previously merged motion tokens and celestial
  primitives to the live Trajectory experience, made the approved shooting star
  the product's only symbol, and gave the existing voice orb a full phase
  vocabulary without replacing it.
- **Key achievements:** Replaced the Lucide sparkle beside Executive Signal with
  the Trajectory shooting-star mark and recoloured the mark to the approved
  white luminous treatment; converted the two fixed-loop CSS shooting stars into
  a single randomised 20–40 second ambient crossing with randomised origin,
  length, angle and travel; added idle, listening, integrating, speaking and
  settling orb phases driven by the real voice status, including internal light
  circulation in place of a spinner; added a three-stage Executive Signal
  transition that fades the previous recommendation, crosses the card with a
  shooting star and fades the replacement in behind a locked body height;
  suspended ambient motion when the page is hidden or unfocused; broadened
  `prefers-reduced-motion` handling to cover the new primitives. Repaired a
  latent defect where the reasoning-state styling keyed off a `thinking` status
  the voice pipeline never emits, so that state previously had no visual
  treatment at all.
- **Verification status:** Language audit, ESLint, strict TypeScript, `node
  --test` and the Next.js production build all pass. The voice phase sequence
  (`idle → listening → integrating → speaking → settling → idle`) was driven
  end to end in Chromium against the real component state machine. The
  Executive Signal transition was traced through all three stages with the body
  height held at the previous value across the swap. Ambient crossings were
  observed over 130 seconds at 34.7 s, 37.6 s and 24.9 s spacing, with zero
  crossings under reduced motion and zero after the page was hidden. Reduced
  motion and a 390 × 844 mobile viewport were captured. Physical iPhone Safari
  verification is still outstanding.

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
- **Deployment:** GitHub default branch deploys to Vercel. A complete Supabase
  environment activates Auth and request-scoped persistence automatically;
  `TRAJECTORY_AUTH_ENABLED=false` remains an emergency kill switch.

## Remaining Work

### Critical

- **Complete a real mailbox-backed authentication acceptance test.** Verify
  signup, email confirmation, session persistence, password reset and sign-out
  with a controlled production test address after configuring production SMTP
  and suitable email rate limits. Expected outcome: operational evidence for
  the external email-delivery portion of the Auth flow.
- **Decide the production access policy.** Vercel Deployment Protection
  currently intercepts all production routes. Expected outcome: either retain
  Vercel-authenticated private testing deliberately or expose Trajectory's own
  Supabase login to approved testers.

### High

- **Complete the remaining Issue #8 motion surfaces.** The splash sequence,
  icon-to-app launch transition, Daily Summary atmospheric states, pull to
  refresh, constellation success and in-app notification transitions are
  specified and have primitives available, but are not yet built into the
  product. Expected outcome: the full cinematic motion system rather than the
  home experience alone.
- **Verify cinematic motion on physical iPhone Safari.** Confirm frame stability,
  battery behaviour, safe-area insets and the reduced-motion path on device
  rather than in desktop emulation. Expected outcome: signed-off mobile motion
  performance.
- **Carry the celestial atmosphere into authentication.** The login, signup and
  recovery surfaces still use the plain gradient shell rather than the starfield
  and nebula treatment described in Issue #8. Expected outcome: a consistent
  Trajectory atmosphere before sign-in.
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

- Google OAuth requires client credentials and redirect configuration.
- Apple Sign In requires Apple Developer configuration and verified domains.
- Live connector testing requires vendor OAuth applications and test accounts.
- Supabase's current default email rate limit blocked live signup acceptance;
  production SMTP and suitable Auth email limits are not yet verified.
- Vercel Deployment Protection currently prevents unauthenticated devices from
  reaching Trajectory's health or login routes.
- Physical Safari and Chrome authentication testing remains outstanding.

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

### 5 August 2026 — Production Supabase activation

- **What changed:** Applied all committed SaaS migrations to the dedicated
  `trajectory-prod` database, added a production-hardening migration, made a
  complete Supabase environment activate Auth by default, and synchronized the
  deployment documentation.
- **Why:** Turn the merged SaaS architecture into an operational, isolated
  production workspace without adding another manual activation step.
- **Verification performed:** Confirmed 27 public tables with RLS and ownership
  policies, zero anonymous table grants, profile/settings provisioning, tenant A
  persistence, tenant B isolation, clean transactional rollback, zero security
  advisor findings, lint, strict TypeScript and production build.
- **Follow-up:** Complete mailbox-backed Auth acceptance, configure Google and
  Apple sign-in, then begin the first vendor connector ingestion adapter.

### 5 August 2026 — Production authentication acceptance follow-through

- **What changed:** Merged PR #4 and exercised Supabase Auth password sessions,
  Data API persistence and provider settings with two temporary production
  identities; all temporary rows and identities were removed afterward.
- **Why:** Verify that the deployed architecture works across Auth, JWT-backed
  RLS, persistent memory and user settings rather than stopping at schema
  inspection.
- **Verification performed:** Both password sessions succeeded; one user wrote
  a conversation and message; the second user could not observe the first
  user's records; the OpenAI preference persisted; Vercel's merge deployment
  reported Ready. Direct application route checks were intercepted by Vercel
  Deployment Protection.
- **Follow-up:** Configure production SMTP/rate limits and decide whether
  Vercel-authenticated private access should remain in front of Supabase Auth.

### 6 August 2026 — Cinematic motion integration

- **What changed:** Wired the merged motion tokens and celestial primitives into
  the live experience, replaced the Executive Signal sparkle with the approved
  shooting-star mark, randomised the ambient crossing cadence, gave the existing
  voice orb five interaction phases, added a non-abrupt Executive Signal
  transition, suspended ambient motion on hidden pages and extended
  reduced-motion coverage.
- **Why:** The motion foundation existed but nothing in the running product
  consumed it, and the reasoning state had no visual treatment because its CSS
  keyed off a status the voice pipeline never emits.
- **Verification performed:** Language audit, lint, strict TypeScript, tests and
  the production build passed. The voice phase sequence, the three-stage signal
  transition with its height lock, the randomised ambient cadence, the
  hidden-page pause and reduced-motion suppression were each exercised in a real
  browser; evidence is in `docs/motion/`.
- **Follow-up:** Verify on physical iPhone Safari, then carry the same motion
  language into the splash and launch transition, Daily Summary atmosphere,
  pull-to-refresh, success and notification states from Issue #8.

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

**Verify the cinematic motion system on a physical iPhone, then complete the
remaining Issue #8 surfaces.**

The home experience now consumes the motion system end to end, but the splash,
launch transition, Daily Summary atmosphere, refresh, success and notification
states remain specified rather than built, and no device-level performance
evidence exists yet. Device verification comes first because it constrains how
much motion the remaining surfaces can afford.

**Then: open the production Auth acceptance path.**

Decide the Vercel Deployment Protection policy, configure production SMTP and
safe email rate limits, then use a controlled mailbox to verify signup, email
confirmation, password recovery and session persistence on mobile and desktop.
This is the highest-impact next step because password Auth, RLS and persistence
are proven, while platform access and transactional email are the remaining
constraints on real-user acceptance testing.
