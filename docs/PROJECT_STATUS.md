# Trajectory Development Status

> Authoritative living record of Trajectory's product progress, engineering milestones, verification history and next recommended milestone.
>
> Last updated: 5 August 2026

## Current PR #7 status

PR #7 remains **draft and unmerged**. The voice finalisation, structured Executive Signal, personalisation, onboarding and morning check-in implementation is deployed to a protected Vercel preview, but physical-device provider acceptance is not complete.

### 5 August 2026 — Preview SSR incident

At approximately 21:51 BST, an authenticated iPhone request to the PR #7 preview failed before rendering with Vercel reference `1387461428`.

The root server component passed the saved explicit OpenAI preference into `computeState()`. When the provider call failed, `src/lib/state/reasoner.ts` wrapped the provider exception as `ProviderRequestError`. That error propagated through `src/lib/state/compute.ts` into `src/app/page.tsx`, aborting server-side rendering.

The root page now calls `computeState({ deterministicOnly: true })`. Ordinary rendering no longer invokes an external provider. Provider synthesis remains confined to explicit interaction routes such as `/api/voice/brief`, where failures remain recoverable and preserve the previous Executive Signal.

The authenticated provider-health endpoint was not imported or executed during ordinary page rendering. Supabase proxy/session recovery was not identified as the source of this incident.

### Current validation evidence

- Language audit: passed.
- ESLint: passed.
- TypeScript: passed.
- Tests: passed.
- Production build: passed.
- Latest Vercel preview deployment: Ready.
- External HTTPS probe reached Vercel but was intercepted with a 302 redirect to `vercel.com/sso-api` on every route. This confirms the protected deployment edge is reachable, but application runtime remains unverified without an authenticated Vercel session or bypass.

### Remaining acceptance gates

- Verify authenticated root and dashboard rendering on the protected preview.
- Verify `/api/diagnostics/provider-health` returns safe diagnostic JSON in the authenticated session.
- Confirm OpenAI Preview key presence, model resolution and capability eligibility.
- Complete one real provider-backed spoken interaction that persists, renders, speaks once and survives refresh.

## Architecture and completed milestones

The established project architecture and prior milestones remain unchanged: Next.js 16 and React 19, Supabase SSR authentication and tenant-scoped persistence, provider-neutral reasoning, the premium orb interaction, structured Executive Signals, dashboard archives, connector foundations and change-aware background intelligence.

## Known blockers

- Vercel Deployment Protection prevents unauthenticated automated probes from reaching application routes.
- Vercel runtime-log access for the connected account returns 403.
- The underlying OpenAI provider error for the failed explicit-provider request has not yet been recovered from runtime logs.
- Physical Safari provider acceptance remains outstanding.

## Next recommended milestone

Use an authenticated Vercel preview session to verify the root route and provider-health endpoint, then run the physical iPhone voice acceptance test and correlate its request ID with provider and Supabase evidence.
