# Cinematic motion verification evidence

Captures from the live Trajectory experience running in Chromium at 1440 × 960,
recorded while the real voice state machine was driven end to end. Speech
recognition, speech synthesis and the `/api/voice/brief` response were replaced
with deterministic stand-ins so each state could be held long enough to capture;
every component, style and state transition shown is the production code path.

| File | State |
|---|---|
| `01-idle.png` | Idle — soft breathing, calm ambient rotation |
| `02-listening.png` | Listening — orb opened outward, surrounding stars lifted |
| `03-integrating.png` | Integrating — brightened orb with internal light circulating, no spinner |
| `04-speaking.png` | Speaking — response pulse while the briefing is spoken |
| `05a-signal-leaving.png` | Executive Signal transition, mid-crossing |
| `05-signal-transition.png` | Executive Signal transition, replacement fading in |
| `06-settled.png` | Settled back to idle after speech completed |
| `07-reduced-motion.png` | `prefers-reduced-motion: reduce` |
| `08-mobile.png` | 390 × 844 mobile viewport, full page |
| `09-mark-header.png` | Header lockup at 8× against the approved brand asset |
| `10-mark-eyebrow.png` | The shooting-star mark beside Executive Signal |
| `11-stale-signal.png` | Provider failure — the previous signal is preserved but labelled `Last valid signal · 02:37` |
| `12-retry-replaced.png` | Successful retry — the replacement signal takes over and the stale marker clears |

The approved source designs these are compared against live in
`public/brand/trajectory-concepts/`.
