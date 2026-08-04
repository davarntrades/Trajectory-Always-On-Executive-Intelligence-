# Trajectory SaaS production checklist

## Repository and build

- [x] ESLint, strict TypeScript and the production build pass on the current implementation.
- [x] Node.js `>=22.0.0` is declared for current Supabase client support.
- [x] The existing orb, voice animation and responsive experience remain structurally unchanged.
- [x] Vercel Cron configuration is versioned in `vercel.json`.

## Supabase and authentication

- [ ] Use a dedicated, confirmed Trajectory Supabase project—not another product database.
- [ ] Apply every migration in `supabase/migrations/` in filename order.
- [ ] Enable email confirmations and set production Site URL / redirect allow-list.
- [ ] Configure Google OAuth in Google Cloud and Supabase Auth.
- [ ] Configure Apple Sign In, Services ID, key and verified domain in Apple Developer and Supabase Auth.
- [ ] Verify email/password signup, verification, sign-in, persistent session, reset and sign-out.
- [x] Profiles and settings are created automatically from the Auth user trigger.
- [x] Every workspace table has owner-scoped RLS; composite conversation ownership prevents cross-tenant message references.
- [x] Browser roles cannot read OAuth state or encrypted connector credentials.

## Vercel environment

- [ ] Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Configure `NEXT_PUBLIC_APP_URL`, `CONNECTOR_ENCRYPTION_KEY` and `CRON_SECRET`.
- [ ] Configure at least one server-side provider key.
- [ ] Configure connector OAuth client IDs/secrets only for connectors being tested.
- [ ] Set `TRAJECTORY_AUTH_ENABLED=true` in Preview after database/provider setup; promote only after Preview verification.
- [ ] Confirm `/api/health` reports `productionReady: true` without revealing values.

## Tenant and connector verification

- [ ] Create two test users and confirm neither can read the other's conversations, messages, goals, briefs, history or settings.
- [ ] Verify provider switching for each configured provider and confirm browser bundles contain no API keys.
- [ ] Verify connect, callback, status, permission update, health sync and disconnect for each configured OAuth connector.
- [ ] Confirm disconnect erases encrypted credential material.
- [ ] Confirm the cron route rejects missing/invalid bearer secrets and skips unchanged source fingerprints.

## Browser verification

- [ ] Verify login, dashboard and orb flow on iPhone Safari and Chrome.
- [ ] Verify the same flow on desktop Chrome.
- [x] Auth and dashboard layouts use safe-area spacing and avoid horizontal overflow at mobile breakpoints.
- [x] Reduced-motion behavior and touch-first orb interaction remain intact.

## Known production boundaries

- Vendor OAuth consoles and Supabase provider settings require external credentials and manual domain verification.
- The connector framework currently validates credential health and records sync runs; vendor-specific data pull, token refresh and event normalization adapters are the next implementation layer.
- The initial background schedule is daily and change-aware. Durable high-frequency retries should move to a queue as private testing expands.
