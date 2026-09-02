# Nutrition Coach Project Context

## Current phase

Turns 1–3 are implemented. Turn 4 cloud persistence and runtime food addition is implemented and locally verified on `turn-4-render-runtime-catalog`. Do not claim deployment acceptance until the credentialed Render staging checks in `docs/verification-plan.md` pass.

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
- The only runtime source workflow is the server-owned, low-volume ScrapingBee adapter restricted to Fuder `/foods/` pages.
- The model receives exactly one food-source function tool with closed arguments. It never receives arbitrary URLs, SQL, browser control, ScrapingBee settings, or database writes.
- Never add accounts, additional profiles, allergies/intolerances, clinical advice, workout/adherence tracking, hydration, micronutrient optimization, target weight, goal switching, plan history, long-term memory infrastructure, weekly variation, or arbitrary AI actions.
- Protein powder remains an ordinary catalog food. There is no supplements workflow or kashrut subsystem.

## Deterministic authority

Application code owns profile state, catalog validation, target calculations, plan totals, weight storage, trend calculations, evidence eligibility, optimistic versions, command idempotency, rate limits, reset, and every Draft-to-Active transition.

The model may extract bounded facts, produce strict Draft content, classify one source food, ask one material food clarification, or call `search_food_source`. Every result is revalidated. No model output directly mutates PostgreSQL or an Active Plan.

## Interaction and safety invariants

- Open question: text enabled, no quick replies.
- Closed question: quick replies enabled, text disabled.
- Food Grid: grid enabled, text disabled.
- Lock each turn before asynchronous work and accept one action.
- A proposal remains Draft until explicit approval.
- Rejecting an adjustment or food candidate continues the conversation.
- Runtime food approval requires exact source/estimate review. Fuder candidates are user-selected; AI estimates are explicit opt-in and permanently labelled unverified.
- Unknown fiber is `null` and contributes zero to deterministic fiber totals.
- Runtime foods are `kosherReview: "not_checked"`; meat/dairy meal rejection still applies.
- Fresh and Existing reset independently. Reset never deletes runtime catalog foods or rate-limit events.
- A stale cloud mutation returns `409`, reloads the latest profile, and requires retry.

## Working protocol

- Keep documentation in English.
- Keep commits atomic and record verification evidence.
- Use strict schemas at every untrusted boundary.
- Preserve the stable scripts: `format:check`, `lint`, `typecheck`, `test:unit`, `build`, `test:e2e`, and `verify`.
- Live OpenAI, ScrapingBee, PostgreSQL, and Render checks supplement but never replace deterministic tests.
- Stop before broadening the source allowlist, model tools, nutrition rules, account model, or Active Plan approval invariant.
