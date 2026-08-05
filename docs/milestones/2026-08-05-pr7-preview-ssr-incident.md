# PR #7 preview SSR incident — 5 August 2026

At approximately 21:51 BST, an authenticated iPhone request to the protected PR #7 preview failed before Trajectory rendered. Vercel displayed error reference `1387461428`.

## Root cause

The root server component passed the saved explicit OpenAI preference into `computeState()`. When the provider call failed, `src/lib/state/reasoner.ts` wrapped the provider exception as `ProviderRequestError`. That error propagated through `src/lib/state/compute.ts` into `src/app/page.tsx`, aborting server-side rendering.

## Repair

Ordinary root rendering now uses `computeState({ deterministicOnly: true })`. External provider synthesis occurs only during explicit interaction routes such as `/api/voice/brief`. A provider failure can no longer take down the root experience.

The authenticated provider-health endpoint is not imported or executed by ordinary page rendering. Supabase proxy/session recovery was not identified as the source of the incident.

## Verification boundary

- Language audit, ESLint, TypeScript, tests and production build passed.
- Vercel reported the new preview deployment Ready.
- An external HTTPS probe reached Vercel but Deployment Protection redirected every route to `vercel.com/sso-api` before application runtime.
- Authenticated root, dashboard and provider-health runtime verification therefore remains outstanding.

PR #7 remains draft and unmerged.