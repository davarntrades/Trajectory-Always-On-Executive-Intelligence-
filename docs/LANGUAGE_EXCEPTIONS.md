# Trajectory language exceptions

This register records prohibited-language matches that are intentionally retained after the product-language migration. It must not be used to justify avoidable user-facing copy.

| File path / scope | Retained term | Reason | User-visible | Future migration required |
|---|---|---|---|---|
| `src/lib/types.ts`, `src/lib/workspace/repository.ts`, API routes and Supabase migrations | `conversation`, `conversationId`, `conversations` | Existing API and database compatibility fields. Renaming would require a versioned schema migration and is unrelated to displayed terminology. | No | No, unless the persistence schema is versioned |
| `src/lib/types.ts`, `src/lib/workspace/repository.ts`, API routes and Supabase migrations | `message`, `messages`, `appendMessage`, `recentMessages` | Existing persistence and transport vocabulary. Components must not render these names as product headings. | No | No, unless the persistence schema is versioned |
| Authentication routes and pages | `message` query parameter and local variable | Compatibility field used to transport registry-sourced authentication outcomes between server actions and pages. The displayed value is canonical Trajectory language. | Identifier: no; value: yes | No |
| Voice persistence and provider adapters | role value `assistant` | Third-party/provider-compatible role discriminator required by stored records and provider APIs. It is never rendered directly. | No | No |
| `ExperienceState.reasoning`, `TrajectoryState.reasoning` and state engine contracts | `reasoning` | Internal compatibility property carrying the text displayed under the product label **Trajectory Logic**. Renaming would alter shared state contracts without improving the UI. | Property name: no; value: yes under approved label | Consider only during a versioned state-contract migration |
| Provider adapters and endpoints | `thinking`, `chat`, `message` | Provider-specific request fields, model configuration or endpoint names required by third-party APIs. | No | No |
| Provider adapters, configuration and usage records | `OpenAI`, `Anthropic`, `Gemini`, `Grok` and provider/model identifiers | Legitimate third-party product names and technical identifiers. | Provider choice may be visible | No |
| `src/lib/store/seed.ts` | Matching words inside synthetic memory, task and domain fixtures | Seed fixtures represent connected-world data used to exercise the state engine, not reusable product chrome. Their content must remain faithful to the simulated source record. | Potentially, as sample data | Replace naturally when live connected data supersedes seed mode |
| Source comments, architecture files and historical documentation | Prohibited terms in explanatory prose | Developer-only documentation is outside the production UI. New documentation should prefer current Trajectory terminology where practical. | No | Opportunistic documentation cleanup only |
| Event titles, goal titles, task titles, calendar entries, user transcripts and stored observation content | Any matching term supplied by a user or connected system | Dynamic user-generated or third-party content must be preserved rather than silently rewritten. | Potentially | No automatic migration; presentation may add context |
| Unique `aria-label` values describing controls | Control-specific terms required for accessibility | Genuinely unique accessibility descriptions may remain component-specific when no shared equivalent exists. | Assistive technology only | Add to registry if reused |

## Enforcement

Shared production copy belongs in `src/content/trajectory-language.ts`. Internal compatibility fields may remain, but must never be surfaced raw as headings, loading states, errors, success states, empty states, notifications or Executive Signal terminology.

The executable audit is `npm run audit:language`. It scans every TypeScript source file, reports each retained match with its path, line and term, and fails when a prohibited term remains in an unapproved rendered literal.
