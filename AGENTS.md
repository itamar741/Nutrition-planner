# Nutrition Coach Project Context

## Current phase

Turns 1–7 are implemented locally. Turn 6 makes USDA candidates nutrition-complete and cached before display. Turn 7 introduces one persisted, state-aware streaming coach. Do not claim deployment acceptance until its credentialed Render gates pass.

## Read first

1. `docs/project-framing.md`
2. `docs/project-description.md`
3. `docs/interface-design.md`
4. `docs/product-specification.md`
5. the applicable goal-specific nutrition guidance
6. `docs/verification-plan.md`
7. `docs/implementation-plan.md`

The written specification wins over conversational memory. Resolve any conflict toward the narrower product boundary.

## Product boundary

- Exactly two shared profiles: Fresh (`new`) and Existing (`existing`).
- Exactly three fixed goals: Fat Loss, Maintenance, and Muscle Gain.
- PostgreSQL is authoritative for both profile aggregates, conversations, catalog, lookup records, command results, and persistent limits.
- The browser holds temporary rendered state and the signed access cookie only.
- The only verified runtime source is the server-owned USDA FoodData Central API adapter, restricted to Foundation Foods and SR Legacy basic foods.
- The model receives only the bounded tools permitted by the current profile state. It never receives arbitrary URLs, raw USDA response bodies, SQL, browser control, source credentials, or database writes.
- Never add accounts, additional profiles, allergies/intolerances, clinical advice, workout/adherence tracking, hydration, micronutrient optimization, target weight, goal switching, plan history, long-term memory infrastructure, weekly variation, or arbitrary AI actions.
- Protein powder remains an ordinary catalog food. There is no supplements workflow or kashrut subsystem.

## Deterministic authority

Application code owns profile state, catalog validation, target calculations, plan totals, weight storage, trend calculations, evidence eligibility, optimistic versions, command idempotency, rate limits, reset, and every Draft-to-Active transition.

The unified coach may extract bounded facts, request deterministic weight writes, request Draft work, ask one material clarification, or request the server-owned USDA workflow. Every tool call is schema-checked and state-checked. USDA candidates are bulk-validated and cached before display; selection never refetches the source. Nutrition extraction is deterministic, and no model output directly mutates PostgreSQL or an Active Plan.

## Interaction and safety invariants

- Open question: text enabled, no quick replies.
- Closed question: quick replies enabled, text disabled.
- Food Grid: grid enabled, text disabled.
- Lock each turn before asynchronous work and accept one action.
- A proposal remains Draft until explicit approval.
- Typed approval language never approves a food, Draft, or adjustment; the visible approval button is mandatory.
- Conversation memory is PostgreSQL-backed and reset-scoped. Above 50 messages or 30,000 characters, the model receives a validated digest plus the latest 20 messages while the complete transcript remains stored.
- One agent turn may be active per shared profile. Repeated command IDs are idempotent and a turn may continue after the browser stream disconnects.
- Rejecting an adjustment or food candidate continues the conversation.
- Runtime food approval requires exact source/estimate review. USDA candidates are user-selected; AI estimates are explicit opt-in and permanently labelled unverified.
- Unknown fiber is `null` and contributes zero to deterministic fiber totals.
- Runtime foods are `kosherReview: "not_checked"`; meat/dairy meal rejection still applies.
- Fresh and Existing reset independently. Reset never deletes runtime catalog foods or rate-limit events.
- A stale cloud mutation returns `409`, reloads the latest profile, and requires retry.

## Working protocol

- Keep documentation in English.
- Keep commits atomic and record verification evidence.
- Use strict schemas at every untrusted boundary.
- Preserve the stable scripts: `format:check`, `lint`, `typecheck`, `test:unit`, `security:check`, `build`, `test:e2e`, and `verify`.
- Apply the five-part Merge-Readiness Pack and record a separate security review before merge.
- Live OpenAI, USDA, PostgreSQL, and Render checks supplement but never replace deterministic tests.
- Stop before broadening the source allowlist, model tools, nutrition rules, account model, or Active Plan approval invariant.
