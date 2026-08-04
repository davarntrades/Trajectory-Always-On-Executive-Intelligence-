# Trajectory production checklist

## Repository and build

- [x] GitHub repository structure is ready for Vercel import.
- [x] The production dependency tree installs from `package-lock.json`.
- [x] `npm run build` succeeds with Next.js 16 App Router.
- [x] TypeScript passes in strict mode.
- [x] ESLint passes with zero warnings.
- [x] Node.js `>=20.9.0` is declared for local and hosted builds.
- [x] No repository, dependency or build blockers remain.

## Runtime and deployment

- [x] Required production environment variables are documented in `.env.example`.
- [x] Secrets remain server-only; no service-role credential is exposed to client code.
- [x] Dynamic executive state and API routes are compatible with Vercel Functions.
- [x] No custom `vercel.json` is required.
- [x] `/api/health` reports runtime mode and missing production configuration without exposing values.
- [x] Static assets and the App Router favicon resolve in production output.
- [x] Metadata, viewport, theme colour and non-indexing directives are configured.

## Browser and responsive behaviour

- [x] Desktop layout renders without horizontal overflow.
- [x] Mobile layout renders without horizontal overflow.
- [x] iPhone safe-area insets are respected with `viewport-fit=cover`.
- [x] Orb touch interaction and reduced-motion behaviour remain available.
- [x] Visual motion uses compositor-friendly transforms and avoids image-heavy particle assets.

## Before each production deployment

- [ ] Add all four required variables to the Vercel Production environment.
- [ ] Apply both Supabase migrations in `supabase/migrations/` to the target project.
- [ ] Enable Vercel Deployment Protection while Trajectory remains a single-user build without application authentication.
- [ ] Deploy and confirm `/api/health` returns `"productionReady": true` and `store: "supabase"`.
- [ ] Load the home screen on iPhone Safari, Chrome and a desktop browser.
- [ ] Confirm the orb can enter listening, thinking and speaking states on a microphone-capable device.
- [ ] Confirm static assets, the favicon and API routes return successfully from the deployed domain.

## Known scope boundary

Trajectory does not yet include end-user authentication or live OAuth connectors. Keep the deployment protected until authentication ships. Connector variables are placeholders for their Phase 2 adapters and are not required for this release.
