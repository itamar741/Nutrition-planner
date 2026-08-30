# Implementation Plan v0.1

Status: Approved by the user on 2026-08-30. Turn 1 was accepted and merged; Turn 2 is authorized on its bounded branch; Turn 3 remains pending later review and authorization.

This plan is governed by [Project Framing](project-framing.md), [Project Description](project-description.md), [Interface Design](interface-design.md), [Product Specification](product-specification.md), the three [nutrition guidance documents](nutrition/maintenance.md), and the [Verification Plan](verification-plan.md). If this plan appears to broaden any of them, the narrower source document wins.

## 1. Chosen Stack

- **Application framework:** Next.js App Router with React and TypeScript.
- **Package manager:** npm with a committed lockfile.
- **Runtime validation:** Zod schemas at every untrusted boundary.
- **AI integration:** the official OpenAI TypeScript SDK and the Responses API, called only from server-side Route Handlers.
- **Application state:** an explicit TypeScript reducer and command layer, persisted in browser `localStorage` for the two demo profiles only.
- **Styling:** locally owned CSS using CSS Modules and shared design tokens; no component framework is required.
- **Charts:** a small project-owned SVG weight chart; no charting dependency is required for the single trend visualization.
- **Automated checks:** ESLint, Prettier, TypeScript, Vitest, React Testing Library, and Playwright.

Next.js is selected because one small project can contain both the React interface and narrow server-only AI endpoints. It avoids a second backend deployment while keeping the API key and model requests out of browser code. A database is intentionally not selected: exactly two demo profiles, resettable local fixtures, and no long-term chat-memory infrastructure make browser persistence sufficient for the course demonstration.

Framework and dependency versions will be pinned by the Turn 1 lockfile rather than copied into this planning document. The OpenAI model name will be supplied through the required server-only `OPENAI_MODEL` environment variable so model selection can be changed without changing application behavior or widening its permissions.

Primary technical references:

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)

## 2. Architecture and Trust Boundaries

```text
Browser
  entry/profile selection
  coaching workspace
  explicit reducer + command lock
  versioned local demo store
              |
              | narrow validated JSON requests
              v
Next.js Route Handlers
  request schema validation
  minimum required context assembly
  OpenAI Responses API call
  response schema validation
              |
              v
Deterministic domain modules
  profile readiness and missing fields
  PAL, EER, target, macro and fiber calculations
  catalog lookup and meal-plan validation
  weight normalization, evidence gate and OLS trend
  idempotency and Draft/Active transitions
```

The diagram shows responsibility, not call order. Deterministic code is authoritative regardless of whether it runs in the browser, in a Route Handler, or in a shared module. The language model never receives a storage handle and never mutates application state.

### Browser responsibilities

- Render the current validated application state.
- Enforce the visible open-question, closed-question, Food Grid, processing, Draft, and Active modes.
- Lock a turn synchronously before any asynchronous request begins.
- Dispatch one typed command carrying a unique `commandId`.
- Persist only the two demo states and their schema version.
- Reset either profile to its committed fixture.

### Server responsibilities

- Keep `OPENAI_API_KEY` and `OPENAI_MODEL` server-only.
- Reject malformed, oversized, or unsupported requests before calling the model.
- Send only the context required for the requested bounded task.
- Request Structured Outputs using a strict JSON schema.
- Disable model tool use; no web search, file search, function tools, MCP tools, or browser tools are supplied.
- Set `store: false` and avoid hosted conversation state; the application supplies the minimum structured context on each request.
- Validate the model response again before returning it to the browser.

### Deterministic domain responsibilities

- Own every formula, tolerance, rounding rule, profile requirement, catalog value, nutrition total, and evidence decision.
- Resolve every food reference through the single catalog.
- Reject unsupported or unapproved foods and meat/dairy combinations.
- Keep Draft and Active plans as separate values.
- Bind each approval to `proposalId`, `basePlanVersion`, and the exact validated proposal.
- Record a weight once per date and make retries idempotent.
- Decide whether an adjustment is allowed and supply its exact direction and kcal magnitude.

## 3. Planned Project Shape

The following is the target layout for implementation. It is not created during this documentation turn.

```text
src/
  app/
    page.tsx
    coach/[profileId]/page.tsx
    api/coach/onboarding/route.ts
    api/coach/draft/route.ts
    api/coach/modify-draft/route.ts
    api/coach/adjustment/route.ts
  components/
    chat/
    checklist/
    food-grid/
    meal-plan/
    weight-trend/
  domain/
    profile/
    nutrition/
    catalog/
    plan/
    weight/
    commands/
  ai/
    client.ts
    contracts.ts
    onboarding.ts
    draft.ts
    adjustment.ts
  data/
    food-catalog.ts
    demo-fixtures.ts
  store/
    demo-reducer.ts
    local-demo-store.ts
tests/
  unit/
  contract/
  fixtures/
  e2e/
docs/
  verification-results/
```

The `domain/` modules must not import React, browser storage, Route Handlers, or the OpenAI SDK. This keeps nutrition arithmetic and state transitions directly testable without the interface or a live model.

## 4. Core Data Contracts

All identifiers are closed enums or opaque IDs created by the application. Every persisted object carries `schemaVersion`.

### Demo identity and profile

- `DemoProfileId`: exactly `new` or `existing`.
- `Goal`: exactly `fat_loss`, `maintenance`, or `muscle_gain`.
- `StructuredProfile`: age, equation sex, height, current weight, fixed goal, routine category, structured weekly exercise minutes, accepted meal pattern, and approved catalog IDs.
- `OnboardingChecklist`: deterministic completion state derived from `StructuredProfile`; it is not separately trusted.

### Conversation interaction

`AssistantTurn` is a discriminated union with only these variants:

- `message`: explanatory text with no input-mode change.
- `open_question`: one question identifier and text input enabled.
- `closed_question`: one question identifier and a predefined option set; typing disabled.
- `food_grid`: the dedicated catalog-selection step; typing disabled.

The model cannot provide arbitrary component names, event handlers, URLs, HTML, or action types. Application code maps a validated variant to a known component.

### Catalog and plan

- `CatalogFood`: one stable catalog ID, source metadata, per-100 g nutrient values, display portions with gram conversions, one category, one meal classification, and the manual kosher-catalog flag.
- `MealPlan`: plan ID, version, fixed goal, target snapshot, meals, gram-based portions, optional validated alternatives, and deterministic totals.
- `DraftProposal`: proposal ID, base plan version or `null`, proposed `MealPlan`, validation result, and proposal reason.
- `ActivePlan`: a validated `MealPlan` plus activation timestamp and version.

Exactly two conversational Draft modifications are supported:

1. `replace_food`: replace one plan food with another approved catalog food.
2. `change_portion`: change the gram quantity of one existing plan food.

Both remain Draft operations and must pass full daily validation. Requests to change meal count, introduce an unknown food, create weekly variation, or perform another action are declined as unsupported.

### Weight and adjustment

- `WeightMeasurement`: measurement ID, ISO calendar date, normalized kilograms, and command ID.
- `TrendFacts`: included range, measurement count, OLS slope, weekly kg change, mean weight, weekly percentage, evidence result, goal-band classification, and optional allowed adjustment facts.
- `AdjustmentProposal`: proposal ID, exact base Active Plan version, deterministic direction and kcal delta, catalog-backed proposed plan, and validation result.

The AI may decide which already-approved food portions best realize an allowed adjustment, but it cannot decide whether an adjustment is eligible, its direction, or its magnitude.

## 5. Application State Machine

### New Demo Profile

```text
EMPTY
  -> ONBOARDING_OPEN
  -> ONBOARDING_CLOSED
  -> FOOD_SELECTION
  -> PROFILE_READY
  -> DRAFT_GENERATING
  -> DRAFT_REVIEW
  -> DRAFT_MODIFYING
  -> DRAFT_REVIEW
  -> ACTIVATING
  -> ACTIVE
```

Open, closed, and Food Grid states may repeat in the order required by missing profile facts. `PROFILE_READY` is reached only when deterministic readiness passes. A failed generation or modification returns to the last confirmed state. Activation accepts only the currently displayed valid proposal.

### Existing Demo Profile

```text
ACTIVE
  -> WEIGHT_VALIDATING
  -> WEIGHT_RECORDED
  -> TREND_CALCULATED
      -> INSUFFICIENT_OR_WITHIN_BAND -> ACTIVE
      -> ADJUSTMENT_GENERATING
      -> ADJUSTMENT_REVIEW
          -> REJECTED -> ACTIVE
          -> APPROVED -> ACTIVE_WITH_NEW_VERSION
```

Recording a valid weight and generating an adjustment are separate operations. If later trend or model work fails, the confirmed measurement remains stored while the Active Plan remains unchanged.

### Cross-cutting turn state

Every state-changing command uses `idle -> submitting -> succeeded | failed`. The transition to `submitting` is synchronous and disables all controls before network work begins. The reducer keeps processed command IDs so retries return the existing result rather than duplicating a message, measurement, proposal, or activation.

## 6. AI Contract Design

The implementation uses separate endpoints and schemas rather than one general assistant endpoint.

### Onboarding endpoint

Input: current supported profile fields, deterministic missing-field list, current allowed interaction modes, and the latest user answer.

Output: a supported fact patch plus one `AssistantTurn`. Code validates every extracted value, merges only supported fields, recalculates the missing-field list, and rejects a next question for an already completed field.

### Draft endpoint

Input: completed profile, deterministic targets, approved catalog subset, accepted meal pattern, and goal-specific validation rules.

Output: one catalog-ID-and-grams Draft candidate. Code recalculates all totals and alternatives and returns an approvable Draft only after every nutrition and catalog check passes.

### Draft-modification endpoint

Input: current Draft, the user's request, the approved catalog subset, and the two allowed modification types.

Output: one typed `replace_food` or `change_portion` proposal, or a typed unsupported-request result. Code applies the proposal to a copy, recalculates the entire day, and never writes the Active Plan.

### Adjustment endpoint

Input: current Active Plan, approved catalog subset, deterministic `TrendFacts`, and the exact allowed direction and kcal delta.

Output: a catalog-backed adjustment composition or a typed failure. Code rejects any different direction, magnitude, base version, food set, or invalid nutrition result.

### Failure policy

- Invalid structured output gets one bounded repair attempt using the same schema and validation errors.
- A second invalid response becomes a controlled retryable failure.
- Transport timeout, refusal, or incomplete output never produces a partial state mutation.
- Live-model behavior is tested only as an integration check. Deterministic acceptance tests use mocked structured responses.
- Runtime instruction templates are application necessities and will live beside their schemas. The project will not create a separate archive of user prompts or a prompt-history workflow.

## 7. Demo Fixtures and Local Persistence

### New Demo Profile fixture

- Empty structured profile.
- No selected foods.
- No Draft or Active Plan.
- Initial coach message and empty checklist derived at reset.

### Existing Demo Profile fixture

- One complete fixed-goal profile.
- One validated Active Plan whose version predates the included measurements.
- Fifty-nine daily seeded measurements ending yesterday; today's chat entry becomes approximately the sixtieth day.
- Values generated from a deterministic tested formula that yields an outside-band trend for the fixed goal and therefore supports the adjustment demo.

Dates are generated from an injected clock at reset, not hard-coded calendar dates. Tests freeze that clock, so the fixture remains reproducible without becoming stale. A separate insufficient-evidence fixture is used in automated and manual controls.

### Persistence rules

- Two fixed local-storage keys, one per demo profile, plus a schema version.
- No additional profile key can be created through the UI or command layer.
- A visible **Reset demo** action restores the selected committed fixture.
- Schema mismatch resets the affected demo safely rather than guessing a migration.
- Client-side state is treated as untrusted when sent to a server endpoint and is revalidated there.

## 8. Interface Implementation Direction

The coaching workspace is desktop-first with a responsive single-column fallback:

- Conversation and current decision occupy the primary column.
- Checklist, plan, or weight trend occupies the context column according to the profile state.
- Draft and Active labels use persistent text and shape, not color alone.
- The approval control sits with the proposal it affects while the current Active Plan remains visible.
- Native buttons and form controls, visible keyboard focus, `aria-live` processing feedback, semantic headings, and reduced-motion support are required from Turn 1.

The visual layer must not add navigation or surfaces for features outside the two demos.

## 9. Three Implementation Turns

Each turn begins from a clean restore-point commit, uses its own branch, adds or updates tests before behavior, records verification evidence, and ends with human review before merge.

### Turn 1 — Foundation and Adaptive Onboarding

Proposed branch: `turn-1-onboarding-foundation`

Deliverables:

1. Scaffold the pinned Next.js/TypeScript project and the planned quality commands.
2. Add the closed domain types, reducer, command IDs, local demo store, reset behavior, and two fixture shells.
3. Implement deterministic profile validation, checklist derivation, PAL mapping, EER and all three initial target calculations.
4. Implement the entry view with exactly two profile choices.
5. Implement the New Demo onboarding workspace, open and closed interactions, processing locks, and checklist feedback.
6. Implement the onboarding Route Handler and strict mocked/live contract boundary with tools disabled.
7. Add empty, invalid, slow, retry, double-submit, and malformed-model controls.

Acceptance focus:

- SC-01 through SC-11, SC-17, SC-18, SC-34 through SC-38.
- VT-01 through VT-05.
- AI-01 through AI-06 and AI-08.
- UI-01, UI-02, UI-04 through UI-07, UI-09, and UI-10 where applicable.

Turn 1 does not generate meal plans and does not implement weight adjustment.

### Turn 2 — Closed Catalog and Draft-to-Active Plan

Proposed branch: `turn-2-catalog-and-plan`

Deliverables:

1. Author the single catalog from reviewed source values, including retrieval metadata, gram conversions, categories, meal classifications, and kosher-catalog review flags.
2. Implement the five-category Food Grid and approved-food persistence.
3. Implement catalog arithmetic, nutrition totals, alternatives, AMDR/fiber/protein checks, and meat/dairy validation.
4. Implement Draft generation with strict structured output and deterministic rejection.
5. Implement only `replace_food` and `change_portion` conversational modifications.
6. Implement version-bound Draft approval and rejection without premature Active mutation.
7. Complete and record Demo A.

Acceptance focus:

- SC-12 through SC-25 and the applicable failure/scope criteria.
- VT-06 through VT-14.
- AI-06 and AI-08 plan-contract cases.
- UI-03 through UI-06, UI-09, and UI-10.
- End-to-end Demo A and the scope/security audit.

Turn 2 does not add weight tracking or plan history.

### Turn 3 — Existing Profile, Weight Trend, and Approved Adjustment

Proposed branch: `turn-3-weight-adjustment`

Deliverables:

1. Complete the Existing Demo Profile, validated Active Plan, relative-date weight seed, and reset behavior.
2. Implement conversational weight parsing followed by deterministic value/date validation and idempotent storage.
3. Implement the SVG visualization, empty/invalid states, evidence gate, OLS trend facts, and goal-band classification.
4. Implement deterministic adjustment direction and the exact 5% / 25-kcal / 100–200-kcal bound.
5. Implement the strict adjustment composition endpoint and proposal validation.
6. Implement version-bound rejection and approval, including evidence reset after activation.
7. Exercise sufficient- and insufficient-evidence fixtures and record Demo B.

Acceptance focus:

- SC-26 through SC-38.
- VT-15 through VT-28.
- AI-07 and AI-08.
- UI-08 through UI-10 plus the shared lock/retry controls.
- End-to-end Demo B, full scope/security audit, and the human merge-readiness review.

Turn 3 does not add ongoing plan history, arbitrary chat memory, or additional analytics.

## 10. Planned Verification Commands

Turn 1 will create these stable npm scripts and record their exact tool versions:

```text
npm run format:check   # exits 0 only when tracked source and docs match formatting rules
npm run lint           # exits 0 with no ESLint errors or warnings
npm run typecheck      # exits 0 with no TypeScript errors
npm run test:unit      # runs deterministic domain, reducer, and contract tests once
npm run test:e2e       # runs Playwright controls against a production-like local server
npm run build          # creates a successful production build
npm run verify         # format:check, lint, typecheck, test:unit, build, then test:e2e
```

No pass may depend on a live OpenAI response. A separate opt-in `npm run test:ai-live` smoke check may verify credentials and one valid structured response, but it is not a substitute for contract fixtures and is not part of ordinary offline unit tests.

## 11. Implementation Authorization and Bounded Content Decisions

The only approval required before Turn 1 is the user's explicit authorization to begin implementation from this plan. The following are bounded deliverables inside the named turns, not reasons for another product questionnaire:

- Turn 1 records the exact visual tokens and copy tone.
- Turn 1 records the exact values and display names for the two demo fixtures.
- Turn 2 records the exact catalog item set and reviewed nutrition-source records.
- Turn 1 records the supported OpenAI model selected in local environment configuration.
- Every turn records its branch, restore point, and criterion-mapped task plan before behavior is edited.

Within these bounds, the implementation agent should make a narrow proposal, verify it against the documents, and include it in the turn's review rather than reopening product scope.

Approval of this document authorizes planning decisions only. It does not itself authorize dependency installation, application scaffolding, a build prompt, deployment, or application code.
