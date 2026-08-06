# PR #7 voice, personalization and daily check-in milestone

Date: 6 August 2026

## Merge

- PR: #7 — Repair voice pipeline and add personalization check-ins
- Merge commit: `6d013e285199cbb4d68e35157aa3b57b682f53c3`
- Tested head: `98a6dd25d3663326b8cb3433d99637ff31a8fb49`

## Completed scope

- Repaired the mobile voice finalisation and submission state machine.
- Added real provider-backed structured Executive Signal generation.
- Added safe provider-health and non-persistent provider probes.
- Activated Anthropic structured output with `claude-opus-5`.
- Added coherent Executive Signal validation and fail-closed provider handling.
- Added persistent user profiles, onboarding, provider preference and editable settings.
- Added daily morning check-ins and reasoning-context integration.
- Added tenant-scoped persistence and verified two-user RLS isolation.
- Restored the latest persisted Executive Signal after refresh and Safari restart.
- Repaired iPhone Safari speech synthesis so the rendered response is spoken once.

## Physical iPhone acceptance

Confirmed on the protected Vercel Preview:

- microphone permission and transcription succeeded;
- the transcript submitted once after stopping recognition;
- Anthropic returned a real structured response;
- the Executive Signal card was replaced with request-relevant content;
- the timestamp updated;
- confidence, urgency, Current State, Current Dynamics, Expected Shift and Suggested Next Action rendered coherently;
- the signal persisted through page refresh and Safari restart;
- the authenticated session remained available;
- speech playback succeeded after the signal rendered.

## Provider verification

- Provider: Anthropic
- Model: `claude-opus-5`
- Provider-health: configured and capability eligible in Preview
- Non-persistent provider probe: HTTP 200 and structured validation passed

## Database and security

- Profile and morning-check-in migrations applied to `trajectory-prod`.
- Owner-scoped Row Level Security verified transactionally with two authenticated identities.
- Excess inherited privileges on `morning_check_ins` were removed.
- Test data was rolled back.

## Validation

Latest tested head passed:

- language audit;
- ESLint;
- strict TypeScript;
- configured test command;
- production build;
- Vercel Preview deployment.

## Remaining blockers

- Confirm the merge deployment reaches Vercel Production Ready.
- Existing unrelated Supabase leaked-password-protection warning remains a project setting.
- Continue broader desktop Chrome and email/password acceptance coverage as a separate milestone.

## Next recommended milestone

Complete post-merge production verification, then begin live connector ingestion and proactive delivery using the now-working persistent voice and Executive Signal foundation.
