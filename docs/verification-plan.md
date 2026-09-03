# Verification Plan v0.2

Status: Active verification plan. Turn 5 adds USDA source, main-chat, security-review, and merge-readiness controls; credentialed Render staging remains pending.

## Purpose

This plan checks the application against the written framing, product specification, interface design, and nutrition guidance. It is deliberately designed before implementation so that the coding agent builds toward named controls rather than inventing its own definition of done.

Verification is a set of complementary checks: tests catch behavior, type checks catch invalid kinds, linters catch dangerous patterns, contract checks validate model output, and review catches a design that is wrong as a whole. A green test suite by itself is not acceptance. The course requires a gate before trust and evidence rather than assertion.

## Scope and Evidence Convention

- The gates below apply to every implementation turn that changes behavior.
- No change reaches `main` without passing every applicable automated gate and a human acceptance review.
- A future implementation must store command output, screenshots where useful, fixture names, and human pass/fail notes under `docs/verification-results/`.
- Each evidence record must identify the Git commit under test, the specification or success-criterion IDs exercised, the command or manual script used, the result, and any known limitation.
- A failing gate blocks acceptance. It is not waived because the interface appears finished or because a deadline is near.

## Gate 0 — Documentation and Restore Point

Before a non-trivial implementation task begins:

1. Confirm that the task maps to an existing success criterion or make a reviewed documentation change first.
2. Confirm the task does not violate `AGENTS.md`, `project-framing.md`, or the out-of-scope list.
3. Confirm relevant nutrition rules are named in the goal-specific guidance rather than guessed.
4. Commit the current reviewed state, leaving a clean Git restore point.
5. Create an implementation branch from that restore point.
6. Write or update the planned test/control cases before implementation.

Evidence: commit SHA, branch name, criterion IDs, and a short task plan.

## Gate 1 — Engineering Hygiene

Once an implementation stack is chosen, the project must define stable commands for formatting, linting, type checking, and unit tests. The commands and their exact expected success conditions must be added to this plan and `AGENTS.md` before implementation is accepted.

The gate passes only when all configured commands exit successfully with no ignored errors. It fails on a missing command, a skipped type check, a linter warning treated as an error by project policy, or an uncommitted generated artifact that belongs in `.gitignore`.

Evidence: complete command output and tool versions.

## Gate 2 — Deterministic Nutrition and State Tests

These tests are written from the specifications and nutrition documents, not inferred from the implementation.

### EER and Goal-Target Controls

- **VT-01:** For the shared reference fixture—male, 30 years, 180 cm, 80 kg, low active—calculate raw EER `2945.77 kcal/day` before goal rounding.
- **VT-02:** The same fixture yields Maintenance `2950 kcal/day`, Fat Loss `2500 kcal/day`, and Muscle Gain `3250 kcal/day` using half-up rounding to the nearest 25 kcal.
- **VT-03:** Age 18 uses the age-18 equation with its 20 kcal/day growth allowance; age 19 uses the adult equation. A fixture on each side of the boundary must prove the equations are not accidentally swapped.
- **VT-04:** PAL mapping is deterministic at every boundary: score 0 inactive, 1 low active, 2–3 active, and 4 very active.
- **VT-05:** Missing or invalid energy inputs produce no targets and no Draft.

### Plan and Catalog Controls

- **VT-06:** A valid Draft uses only approved catalog identifiers and calculates food nutrients from stored per-100 g values and gram portions.
- **VT-07:** A nonexistent catalog identifier or food not approved for the profile is rejected by plan validation. A missing-food request may create only a bounded lookup job; it cannot create a catalog item or nutrition value before explicit candidate approval.
- **VT-07a:** An existing central-catalog food is offered as **Add to my foods** without an external lookup. The action adds it only to the requesting PostgreSQL profile aggregate and is idempotent.
- **VT-07b:** A source result with missing fiber stores fiber as unknown and does not contribute to the plan's fiber total.
- **VT-08:** A meal that combines a `meat` and `dairy` classification fails validation; a neutral or single-classification meal can pass.
- **VT-09:** Each displayed food alternative independently passes the applicable daily energy tolerance, protein range, age-appropriate AMDR ranges, fiber minimum, catalog, and meal-composition checks.
- **VT-10:** A plan outside ±5% of goal energy, below fiber minimum, outside macro ranges, or outside goal protein range cannot become Active.

### Draft and Active Plan Controls

- **VT-11:** Generating or modifying a Draft never alters the Active Plan.
- **VT-12:** Approving the exact current valid Draft promotes it to Active once.
- **VT-13:** Rejecting a Draft, retrying a failed approval, or submitting the same approval command twice does not duplicate or alter state.
- **VT-14:** Approval of a stale Draft or adjustment proposal whose base Active Plan version no longer matches is rejected.

### Cloud Persistence Controls

- **VT-14a:** Fresh and Existing mutations are isolated. A stale expected version returns the current state and makes no write.
- **VT-14b:** Reusing one mutation command returns the original result without incrementing the profile version twice.
- **VT-14c:** Resetting Fresh does not alter Existing, runtime catalog foods, or rate-limit events. Resetting Existing restores its original plan and generated weights without altering Fresh.
- **VT-14d:** Approving one runtime food inserts the catalog record and selects it for the requesting profile in one transaction. A stale approval inserts neither half of that transaction.
- **VT-14e:** A signed access token accepts no tampering; the wrong shared code fails; rate identities contain only stable HMAC hashes.
- **VT-14f:** The eleventh hourly workflow for one hashed session/IP and the thirty-first global daily workflow are rejected, including after a profile reset.

### Weight and Trend Controls

- **VT-15:** Valid weights normalize to kilograms. A new date appends exactly one plotted point; replacing a selected existing date updates that point without creating a duplicate. Invalid values do not create a plotted point.
- **VT-16:** Fewer than 28 valid unique-date measurements in the most recent 35 days, a span shorter than 28 days, or any Active Plan change in the included span produces `insufficient_evidence` and no energy proposal.
- **VT-17:** A qualifying fixture calculates ordinary-least-squares slope, weekly kilograms, mean weight, and weekly percentage from unrounded values. Only displayed values are rounded.

### Trend Classification Controls

Generate 35 daily points from `weight(day) = 80 + (slope_kg_per_day × day)` and keep the Active Plan unchanged for the full window.

- **VT-18 — Fat Loss within band:** slope `-0.0857142857 kg/day` produces an approximately `-0.75%/week` trend and no proposal.
- **VT-19 — Fat Loss slow:** slope `-0.0285714286 kg/day` produces an approximately `-0.25%/week` trend and permits only a decrease.
- **VT-20 — Fat Loss fast:** slope `-0.1428571429 kg/day` produces an approximately `-1.25%/week` trend and permits only an increase.
- **VT-21 — Maintenance stable:** slope `0` produces no proposal.
- **VT-22 — Maintenance gain:** slope `+0.0571428571 kg/day` produces an approximately `+0.50%/week` trend and permits only a decrease.
- **VT-23 — Maintenance loss:** slope `-0.0571428571 kg/day` produces an approximately `-0.50%/week` trend and permits only an increase.
- **VT-24 — Muscle Gain within band:** slope `+0.0428571429 kg/day` produces an approximately `+0.375%/week` trend and no proposal.
- **VT-25 — Muscle Gain slow:** slope `0` permits only an increase.
- **VT-26 — Muscle Gain fast:** slope `+0.0857142857 kg/day` produces an approximately `+0.75%/week` trend and permits only a decrease.
- **VT-27:** Every allowed adjustment is exactly 5% of current Active Plan energy, rounded half-up to 25 kcal and clamped to 100–200 kcal. The AI receives that exact bound and cannot substitute another value.
- **VT-28:** After an approved adjustment, the evidence gate resets until a new qualifying unchanged-plan window exists.

## Gate 3 — Structured AI Contract Tests

Run these controls with mocked or recorded model responses. Do not rely on variable live-model responses for deterministic pass/fail tests.

- **AI-01:** One valid free-text answer containing at least three supported profile facts updates all recognized fields and only those fields.
- **AI-02:** The next onboarding question requests only a still-missing required field.
- **AI-03:** Valid open-question output enables text input with no quick replies.
- **AI-04:** Valid closed-question output renders only the predefined quick replies and disables text input.
- **AI-05:** A valid Food Grid request is accepted only at the designated onboarding stage and disables text input.
- **AI-06:** Prose where a structured response is required, an unknown response type, arbitrary widget instruction, unknown action, invented food identifier, missing required field, or invalid enum is rejected before it can render controls or mutate state.
- **AI-07:** The model cannot bypass deterministic insufficient-evidence status, change an allowed adjustment direction or magnitude, write weight history, or mark a proposal Active.
- **AI-08:** A model timeout or transport failure preserves confirmed state and returns a retryable failure without duplicate effects.
- **AI-09:** Food-addition routing accepts only its closed action union. User text and parsed source fields that attempt to override instructions, invoke tools, provide URLs, or request database writes are treated as data and cannot create an action outside that union.
- **AI-10:** An AI-estimate candidate is visibly and structurally labelled `AI estimate · USDA not verified`; it has no verified-source URL and cannot be stored without explicit approval.
- **AI-11:** The food tool accepts only a normalized English query and closed preparation enum. Hebrew and English user text, injected URLs, SQL, tool names, or database instructions cannot add arguments or actions.
- **AI-12:** USDA response bodies are never supplied to the model. The model may return only the closed category and meal classification for the selected title; it cannot create or change nutrition values.
- **AI-13:** USDA search candidates are bulk-validated and cached before display. Selection reads the cached nutrition and performs no second USDA request.

Evidence: input fixture, expected contract result, actual validator result, and unchanged-state assertion for every rejected response.

## Gate 4 — Interface, Feedback, and Race Controls

Use browser-level tests where feasible and manual acceptance scripts for visual behavior that cannot be reliably automated.

- **UI-01:** Open question: text input enabled; quick replies absent.
- **UI-02:** Closed question: quick replies visible in the conversation; text input disabled.
- **UI-03:** Food Grid: selection controls enabled; text input and unrelated actions disabled.
- **UI-04:** One action per turn: a double-click, rapid double tap, and simultaneous keyboard/click attempt result in exactly one accepted user action and one transcript message.
- **UI-05:** During processing, all active controls lock and a specific progress message identifies the operation.
- **UI-06:** Slow processing preserves the submitted action, presents delayed-state feedback, and prevents duplicate retries until the operation resolves.
- **UI-07:** Empty New Demo Profile shows an initial coach message, empty checklist, and explanatory empty plan area; it does not show a blank chat.
- **UI-08:** An invalid weight stays out of the chart, retains the submitted message, and prompts for correction.
- **UI-09:** A failed Draft, trend, proposal, or approval operation leaves confirmed state visible and never labels a failed proposal as Active.
- **UI-10:** Draft, proposal, and Active labels are visible and unambiguous before and after every approval or rejection.
- **UI-11:** A missing-food request shows one clear sequence: clarification when required, explicit candidate choices when multiple results exist, source-labelled review, and Approve/Reject controls.
- **UI-12:** An existing central-catalog match shows **Add to my foods** and never starts a USDA lookup.
- **UI-13:** Queued, slow, blocked, zero-result, malformed-source, and fallback states preserve the confirmed profile and plan while explaining the next available action.

Evidence: automated trace where available, plus a screenshot or short manual pass/fail note for each visual control.

## Gate 5 — End-to-End Demo Acceptance

### Demo A — New Demo Profile

1. Start from the committed empty New Demo Profile fixture.
2. Submit one free-text response containing multiple required facts; verify multiple checklist completions.
3. Verify the next question is only for missing information.
4. Complete an open question and a closed quick-reply question, including the turn-lock control.
5. Complete the five Food Grid categories.
6. Generate a valid, catalog-backed Draft within the selected goal's nutrition limits.
7. Request one supported Draft modification and verify the Active Plan remains unchanged.
8. Approve the Draft and verify the exact validated Draft becomes Active.

### Demo B — Existing Demo Profile

1. Start from the committed Existing Demo Profile fixture with an Active Plan and approximately two months of seeded weights.
2. Verify the plan and weight visualization load before any new message.
3. Enter a valid new weight and verify one new plotted point.
4. Verify the deterministic trend facts, evidence result, and goal-band classification against the fixture.
5. Run an insufficient-evidence control and verify no caloric proposal appears.
6. Run a sufficient-evidence control, verify a bounded Draft proposal, and verify the Active Plan has not changed.
7. Reject once and verify no change; rerun and approve once, then verify the validated proposal becomes Active.

Evidence: one checklist per demo, linked screenshots, fixture version, and a human pass/fail decision.

### Runtime Catalog Demonstration

1. Request a food already in the central catalog and verify the **Add to my foods** path without a source request.
2. Request one missing basic food in the main coach conversation; answer any material preparation clarification and choose one explicit USDA result.
3. Verify the source, retrieved time, per-100 g values, optional serving information, and the approval requirement before persistence.
4. Approve once; verify one central catalog record and current-profile approval. Retry once and verify no duplicate record.
5. Request a plan change using the newly approved food and verify that it creates only a Draft.
6. Exercise a blocked, zero-result, or malformed-source fixture; verify the catalog and Active Plan remain unchanged and the optional AI estimate is visibly unverified.

## Gate 6 — Scope and Security Audit

Before accepting an implementation turn, inspect the visible product, dependencies, model configuration, and data flows for scope leakage.

The audit fails if it finds authentication, additional profiles, unrestricted runtime internet search, a general crawler, browser-enabled AI, arbitrary tools or actions, unvalidated AI output, direct AI writes to PostgreSQL, Active Plan, or weight history, allergy/medical features, target weight, goal switching, plan history, weekly plan variation, workout/adherence tracking, hydration, micronutrient optimization, or a kashrut subsystem.

Run `security:check`, inspect dependency and lockfile changes, and run `npm audit --audit-level=high`. Confirm the USDA adapter is server-owned, dataset-restricted, low-volume, parameterized, and cannot pass API responses or credentials to the model or browser. Review SQL parameterization, React-safe rendering, access-cookie enforcement, lookup limits, and safe audit logs.

## Gate 7 — Render Deployment and Source Controls

- **DP-01:** The Web Service can start with only its documented Render environment variables; no credential is present in tracked files or browser bundles.
- **DP-02:** PostgreSQL migrations run safely on an empty staging database and are idempotent when reapplied through the chosen migration tool.
- **DP-03:** The Web Service performs one bounded synchronous USDA workflow, searches only Foundation Foods and SR Legacy, and cannot accept a public arbitrary URL or browser-supplied `fdcId`.
- **DP-04:** A bounded timeout, `403`, `429`, malformed API response, missing required nutrient, or database error returns a controlled failure without mutating the catalog or profile.
- **DP-05:** The Web Service reports searching, candidate-selection, review, and failure states without exposing USDA response bodies, source credentials, or database details.
- **DP-06:** A Render staging deployment completes one approved candidate flow and one controlled failure flow.

## Gate 8 — Human Merge-Readiness Review

The user reviews the change only after automated and end-to-end gates pass. The review records five evidence-backed conclusions:

1. **Functional completeness:** each affected success criterion passes.
2. **Sound verification:** gates exercised the named failure modes rather than merely executing lines.
3. **Engineering hygiene:** formatting, lint, type checks, tests, and ignored/generated files are clean.
4. **Rationale:** the change remains consistent with the framing, specification, nutrition guidance, and intentional scope.
5. **Audit trail:** commits, fixtures, verification output, manual results, and documentation changes are present and legible.

No change is accepted on the strength of appearance alone.

## Planned Command Registry

The implementation plan selects npm, ESLint, Prettier, TypeScript, Vitest, React Testing Library, Playwright, and the Next.js production build. Turn 1 must create these scripts and record the pinned tool versions in its verification evidence:

- `npm run format:check` — exit 0 only when tracked source and documentation match the configured formatting rules.
- `npm run lint` — exit 0 with no ESLint errors or warnings.
- `npm run typecheck` — exit 0 with no TypeScript errors.
- `npm run test:unit` — run deterministic domain, reducer, and structured-contract tests once and exit 0 only when all pass.
- `npm run security:check` — scan tracked files for common committed secret forms and fail before build or merge.
- `npm run test:e2e` — run Playwright controls against a production-like local server and exit 0 only when all pass.
- `npm run build` — produce a successful production build.
- `npm run verify` — run `format:check`, `lint`, `typecheck`, `test:unit`, `security:check`, `build`, and `test:e2e`; fail immediately or return nonzero if any mandatory check fails.

An opt-in `npm run test:ai-live` may be added for one credentialed structured-response smoke test. It must not be included in offline deterministic acceptance and cannot replace mocked AI contract controls.
