# Product Specification v0.3

Status: Active final specification. Turns 1–8 and the conversational topic boundary are implemented. The academic deployment and security gates are consolidated in [Phase 6](verification-results/phase-6.md); the later topic-boundary verification is recorded separately in [Coach topic-boundary verification](verification-results/coach-topic-boundary.md).

This specification is governed by [Project Framing](project-framing.md), [Project Description](project-description.md), and [Interface Design](interface-design.md). If a future interpretation expands the product beyond those documents, the narrower documented scope wins until the specification is deliberately revised.

## Part 1 — Goal and Reason

### Goal

Build a narrow demonstration application containing exactly two predefined profiles in which a conversational nutrition coach:

- adaptively collects the information needed for a beginner's nutrition plan;
- builds one repeatable daily meal plan from a curated catalog with explicit, reviewed additions;
- separates every proposed plan from the Active Plan until the user approves it; and
- uses deterministic weight-trend facts to support a bounded AI adjustment proposal.

The coach supports adults aged 18 and older who exercise but are beginners in nutrition, and exactly three fixed goals: **Fat Loss**, **Maintenance**, and **Muscle Gain**.

### Reason

The product exists to let a nutrition beginner turn ordinary conversation and ongoing weight measurements into a practical, reviewable meal plan without first learning nutrition planning, while keeping calculations, allowed actions, and state changes constrained and verifiable.

### Decision Rule for Unwritten Cases

When an unforeseen design choice appears, prefer the choice that:

1. makes Demo A or Demo B more reliable and observable;
2. keeps nutritional calculations and state transitions deterministic;
3. keeps AI actions narrow and reversible until approval; and
4. avoids adding a capability that is not required by either demo.

## Part 2 — Testable Success Criteria

Each criterion must produce a clear pass or fail result. Nutrition criteria use the formulas, ranges, thresholds, and reference fixtures in the three goal-specific guidance documents.

### Demonstration Boundary

- **SC-01 — Exactly two profiles:** After the optional shared-code gate, the entry view offers only **New Demo Profile** and **Existing Demo Profile**. It offers no accounts, registration, new-profile creation, or account management.
- **SC-02 — Fixed goals:** Goal selection offers only **Fat Loss**, **Maintenance**, and **Muscle Gain**. After onboarding, the selected goal cannot be changed.
- **SC-03 — Closed action space:** Every state-changing user action maps to one supported application action. Browser requests contain only action facts and identifiers; free text cannot cause free browsing, direct catalog mutation, arbitrary tool use, an unrecognized state transition, or a browser-authored assistant message.

### New Demo Profile and Adaptive Onboarding

- **SC-04 — Empty starting state:** Selecting New Demo Profile loads no completed nutrition profile, no Draft, and no Active Plan, then displays the first onboarding message and the visible completion checklist.
- **SC-05 — Multi-fact extraction:** Given one supported free-text response containing at least three required profile facts, the system stores all correctly recognized facts in the structured profile during the same turn and marks the matching checklist items complete.
- **SC-06 — Ask only for missing information:** After processing an answer, the next onboarding question requests information that is still required and does not ask again for a valid fact already stored.
- **SC-07 — Open-question behavior:** When the active question is open, free-text input is enabled and no quick-reply control is presented.
- **SC-08 — Closed-question behavior:** When the active question is closed, predefined quick replies appear inside the conversation and free-text input is disabled.
- **SC-09 — One action per turn:** After a quick reply, text submission, or Food Grid submission, every control for that turn locks immediately. Repeated clicks or simultaneous submission attempts result in exactly one accepted action and one user-message entry.
- **SC-10 — Processing lock:** While the system processes a user action, all input controls are disabled and visible progress feedback is present.
- **SC-11 — Required profile fields:** A Draft cannot be requested until the structured profile contains age, biological sex, height, current weight, one supported goal, sufficient daily-routine and movement information, exercise type, exercise frequency, approximate session duration, an accepted meal pattern, and completed food preferences.

### Catalog and Preference Grid

- **SC-12 — Five catalog categories:** The Food Grid exposes selectable catalog foods grouped as carbohydrates, proteins, fats, vegetables, and fruits.
- **SC-13 — Selected-food persistence:** Submitting a valid Food Grid selection stores the chosen catalog identifiers as the profile's approved foods and visibly completes food preference progress.
- **SC-14 — Controlled catalog addition:** A missing basic food can enter the catalog only after an existing-catalog check, a bounded source search from the supplied basic-food name, explicit user selection of a returned USDA candidate or a clearly labelled AI estimate, deterministic validation, and explicit approval. A focused clarification is allowed when no food name was supplied or no genuine source match exists. Recipes, restaurant items, branded products, composite dishes, bulk import, and automatic catalog mutation are rejected.
- **SC-15 — Shared source of food truth:** The preference grid and plan calculations use the same curated catalog entries and nutritional values. A runtime source may produce a reviewable candidate, but only an approved validated record becomes a catalog entry.
- **SC-16 — Kosher simplification:** Every catalog item used by the application is from the pre-reviewed kosher-oriented catalog, and deterministic validation rejects a meal containing both meat and dairy classifications. No separate kashrut workflow or inference system is present.

### Targets and Draft Meal Plan

- **SC-17 — Deterministic target calculation:** Given a completed profile fixture, deterministic code reproduces the applicable EER equation, PAL mapping, goal energy rule, macronutrient targets, fiber minimum, and half-up rounding defined in [Fat Loss](nutrition/fat-loss.md), [Maintenance](nutrition/maintenance.md), or [Muscle Gain](nutrition/muscle-gain.md).
- **SC-18 — No premature target calculation:** If a required target-calculation input is missing or invalid, no targets or Draft are created and the missing or invalid input is identified.
- **SC-19 — Catalog and preference compliance:** Every food in a generated Draft references an existing catalog item approved for that profile.
- **SC-20 — Practical daily plan:** The Draft represents one repeatable day, follows the selected three-meal, three-meals-plus-snack, or four-meal pattern, and uses practical quantities and units without food-substitution alternatives.
- **SC-21 — Nutrition acceptance:** Deterministic recalculation of the Draft falls within the ±5% energy tolerance, goal-specific protein range, age-appropriate AMDR ranges, fiber minimum, and catalog/meal constraints defined by the applicable nutrition guidance.
- **SC-22 — Failed validation cannot activate:** A Draft that fails catalog, meal-composition, or nutrition validation is not presented as valid and cannot become Active.
- **SC-23 — Supported Draft modification:** A supported conversational change creates a new validated Draft rendering while leaving any current Active Plan unchanged. When the change requires an approved food, the Draft includes it at a valid portion and rebalances the complete plan rather than appending it to unchanged meals.
- **SC-24 — Explicit activation:** Selecting the dedicated approval action for a valid Draft promotes that exact Draft to Active and renders it with an **Active Plan** label.
- **SC-25 — Decline preserves state:** Declining activation or requesting another change does not replace the current Active Plan.
- **SC-25a — Existing ordinary Draft:** Existing may create an ordinary Draft through the same bounded Draft skill as Fresh. It uses the current Active Plan target snapshot and cannot change the Active Plan before its dedicated approval action.

### Existing Demo Profile and Weight Adjustment

- **SC-26 — Seeded existing state:** Selecting Existing Demo Profile loads one completed structured profile, one Active Plan, and approximately two months of dated seeded weight measurements without requiring historical chat messages.
- **SC-27 — Weight entry validation:** A valid conversational weight entry is normalized to the supported unit representation, stored exactly once with its date, and rendered in the weight visualization. An invalid entry is not stored or plotted.
- **SC-28 — Deterministic trend:** For a fixed weight-history fixture, deterministic code returns the expected trend facts and the expected sufficient-evidence result without consulting the AI.
- **SC-29 — Insufficient evidence:** When there are fewer than 28 valid unique-date measurements in the most recent 35 days, the measurements span fewer than 28 days, or the Active Plan changed during that span, no evidence-based caloric adjustment proposal is created and the Active Plan remains unchanged.
- **SC-30 — Sufficient evidence proposal:** When the evidence gate passes, deterministic code calculates the ordinary-least-squares weekly percentage trend, selects the goal-band result, and supplies the AI with one allowed direction and an exact adjustment equal to 5% of Active Plan energy rounded to the nearest 25 kcal and clamped to 100–200 kcal. For Maintenance, either an out-of-band rate or two consecutive seven-measurement averages at least 0.70 kg from the stored Active Plan baseline may select the direction. The AI may return only a catalog-backed proposal within that bound.
- **SC-31 — Proposal remains Draft:** Rendering an adjustment proposal does not change the Active Plan or label the proposal as active.
- **SC-32 — Adjustment approval:** Approving a valid adjustment proposal replaces the Active Plan with the validated proposed plan and visibly renders the change.
- **SC-33 — Adjustment rejection:** Rejecting or ignoring a proposal leaves the Active Plan unchanged.

### Failure, Recovery, and Scope

- **SC-34 — Failure preserves confirmed state:** A failed message, Draft, weight-recording, trend, proposal, or approval operation never claims or renders a state change that the deterministic store did not confirm.
- **SC-35 — Retry is idempotent:** Retrying the same failed action cannot create duplicate chat actions, weight records, activations, or adjustment approvals.
- **SC-36 — Invalid AI contract:** AI output that does not match an allowed structured response is rejected before it can render controls or mutate application state.
- **SC-37 — No unsupported product surfaces:** The demonstrable interface contains no authentication, additional-user management, allergies or intolerances, workout tracking, adherence tracking, hydration, micronutrient optimization, supplement recommendation workflow, target weight, goal switching, plan history, weekly plan variation, unrestricted internet search, or a general-purpose crawler.
- **SC-38 — No unapproved Active Plan mutation:** Across all validation and error cases, the Active Plan changes only after a valid, explicit approval action tied to the currently displayed Draft or adjustment proposal.

### Cloud Persistence and Runtime Food Addition

- **SC-39 — Cloud authority:** PostgreSQL is authoritative for both versioned profile aggregates, conversations, catalog foods, source provenance, lookup requests, candidates, idempotent command results, and rate-limit events. The browser never supplies an authoritative replacement profile, Draft, target snapshot, validation result, Active Plan, or assistant transcript entry.
- **SC-40 — Independent reset:** Fresh reset restores only the empty Fresh seed. Existing reset restores only its prepared profile, Active Plan, conversation, and generated weight history. Neither reset deletes runtime foods or rate-limit events, and there is no Reset all control.
- **SC-41 — Optimistic conflict:** Every mutation supplies an expected version and idempotency command. A stale request returns `409`, reloads the current profile, and applies no stale overwrite.
- **SC-42 — Shared access:** Deployed routes require one shared access code represented by a signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Production fails closed without the code and a signing secret of at least 32 characters, and configuration failures issue no cookie. This gate does not create accounts or a general authentication system.
- **SC-43 — Persistent limits:** Access-code verification permits at most five attempts per 15 minutes in one shared anonymous pre-access bucket. Food lookups are limited to 10 workflows per hour for the same verified, HMAC-hashed signed session and 30 per day globally. Agent turns are limited to 30 in a rolling one-minute window for that verified session; the remaining cooldown is loaded from the server after refresh. Client-controlled forwarding headers do not create identities, raw IP addresses are never stored, and reset does not clear events.
- **SC-44 — Bounded source workflow:** `search_foods` accepts the original food phrase, a normalized English query, and either `catalog_only` or `integrate_into_plan`. The server checks the central catalog, searches only Foundation Foods and SR Legacy, retrieves up to 50 sanitized identity summaries, validates one to five model-ranked source identifiers from that pool, caches only their nutrition-complete candidates, and requires explicit approval. Candidate selection never triggers another USDA request. Plan integration creates or continues a durable Plan Change operation.
- **SC-45 — Arnold conversation:** Every free-text turn uses one server-owned Arnold endpoint with authoritative structured profile context, reset-scoped ordinary role/content transcript memory, the complete bounded Arnold skill set, durable user-visible output, and persisted activity events. Arnold chooses a sequential skill plan without an intent classifier; server-side schemas, prerequisites, validations, and approval boundaries remain authoritative.
- **SC-46 — Protected approvals:** Typed approval cannot insert a food or change an Active Plan. Food, Draft, and adjustment approval succeeds only from its current visible button and validated server state.
- **SC-47 — Durable interactions:** Clarifications, candidate lists, review cards, Drafts, and adjustment proposals survive reloads. One agent turn is active per profile; command IDs are idempotent and stale or concurrent requests return recoverable conflicts.
- **SC-48 — Bounded memory:** The complete transcript remains in PostgreSQL and is rendered until profile Reset. When the estimated request exceeds 60% of the configured model context window, the model receives a validated rolling digest and the latest 20 messages; structured state always overrides the digest.
- **SC-49 — Runtime plan continuation:** Approval adds one idempotent central food and selects it only for the requesting profile. If the request arose during planning, Arnold asks whether to include it before creating a new validated Draft. For an Existing plan, that Draft retains the Active Plan targets, includes the approved food, rebalances other approved portions or foods when necessary, and visibly summarizes the changes. It never directly changes the Active Plan.
- **SC-50 — Preference and availability skills:** Arnold may persist only clear structured user preferences, inspect the catalog/profile/plan for current food availability, and remove an approved food from future Drafts. These operations are bounded server skills; removing a food never mutates an Active Plan.
- **SC-51 — Visible nutrition decision journey:** Once deterministic targets exist, the interface shows a progressively disclosed, profile-derived explanation of the activity mapping, raw EER, goal rule, rounding, macro and fiber targets, and named research sources. A rendered Draft or Active Plan shows actual totals against its deterministic validation ranges. A profile with weight history shows evidence progress, weekly rate, goal band, Maintenance drift facts when applicable, and the deterministic reason for keeping the plan or permitting a bounded adjustment. The displayed explanation and server decision use shared domain rules, make no additional AI request, and are reusable for any valid supported profile without depending on a demo identifier.
- **SC-52 — Server-owned proposal approval:** A visible approval sends only profile, version, command, proposal/interaction identifiers, and the approval action. The server loads the current stored proposal, verifies its base Active Plan version, recalculates validation from authoritative data, and activates it at most once.
- **SC-53 — Single AI boundary:** `/api/coach/message` is the only public route that invokes AI behavior. Onboarding, Draft, modification, adjustment, lookup, candidate preparation, and estimate helpers have no separate public route.
- **SC-54 — Transport and error controls:** Production page and API responses include the documented security headers. When database TLS is enabled, both application and migration pools verify certificates and reject conflicting URL options. The academic Render Blueprint may use only its same-region internal private-network URL without TLS as a documented exception. Client responses never expose raw exception, credential, database URL, source payload, or environment text.
- **SC-55 — Submission archive control:** The exact academic-submission ZIP excludes Git history and local environment files and passes the bounded archive secret/container inspection before submission.
- **SC-56 — Production persistence:** Production requires PostgreSQL configuration and must return a generic unavailable response rather than falling back to the development/test memory adapter.
- **SC-57 — Conversational topic boundary:** Arnold answers only nutrition planning, food and basic meal preparation, weight tracking, and high-level non-medical fitness questions. For programming, technical support, or unrelated requests, it gives one brief same-language redirect without answering any part of the request or calling a skill. It does not create personalized workout programs or tracking. This best-effort model behavior does not replace server validation of tools and protected state.
- **SC-58 — Open planning, closed effects:** All documented Arnold skills are visible on a free-text turn. Inapplicable calls return `blocked`; user decisions return `needs_user_action`; deterministic validation failures return `rejected`; successful effects return `completed`. Each successful mutation is committed under the active turn lease before the result is returned to Arnold, so a later failure does not undo earlier completed actions.
- **SC-59 — Durable Plan Change:** A plan-changing request has a stable operation identifier, explicit lifecycle state, source evidence, baseline, required, unresolved and excluded foods, scope, strategy, stored alternative choices, attempt batch, and current Draft reference. Food and Draft interactions carry that identifier. Food approval leads to a visible `Create Draft` action; only Draft approval may replace the Active Plan.
- **SC-60 — Durable Draft repair:** Every rejected Draft attempt is persisted immediately with its complete meals, gram amounts, calculated totals, target checks, and issues. While attempts remain in the current batch, Arnold must submit the next complete repair in the same turn rather than ask permission or replace the Draft with prose. The third rejection creates the visible failure review; an explicitly selected retry strategy starts a new three-attempt batch.
- **SC-61 — Plain assistant text:** Model prose is normalized before persistence and display so safe numeric and common named character entities render as their intended text rather than leaking strings such as `&#x20;`.

## Part 3 — Architectural Guidance

Keep the implementation boundary small: a chat-and-state interface communicates with an application layer that owns structured profile, catalog, plan, and weight state. Deterministic modules own all nutrition arithmetic, catalog validation, weight-trend calculations, evidence thresholds, idempotency, and Draft-to-Active transitions; the language model receives narrow structured context and returns only validated response types. The model has no browser, unrestricted tool access, database write path, or direct write path to the Active Plan or weight history.

Use one central Food Catalog as the sole source for preference choices and nutritional values. The Next.js server may query USDA FoodData Central for one explicitly requested basic-food workflow at a time; API results are parsed deterministically and only sanitized normalized candidates are shown to the model and browser. Keep exactly two deterministic demo-state fixtures in PostgreSQL. Conversation memory is deliberately reset-scoped rather than general long-term memory infrastructure. Preserve clear Draft and Active Plan representations so every proposal is reversible until an explicit approval command succeeds.

Implementation-specific frameworks, filenames, component trees, database choices, and internal function names are intentionally left to the later implementation plan, provided they preserve these boundaries.

### Required Structured Contracts

The implementation plan must define and validate narrow contracts equivalent to the following concepts without expanding the action set:

- A structured demo profile and onboarding-completion state.
- An assistant message with either no interaction, one predefined quick-reply set, or the dedicated Food Grid step.
- A catalog-backed Draft Meal Plan and an Active Plan.
- A source-labelled Food Addition Candidate plus explicit approval or rejection command.
- A validated weight-record command and deterministic trend result.
- A bounded adjustment proposal tied to a specific Active Plan state.
- An explicit approval or rejection command tied to the proposal currently shown.

The AI may help produce language or a proposed Draft, but application code validates every structured result before rendering an interactive control or committing state.

## Part 4 — Validation Approach

Validation is designed before implementation and uses deterministic fixtures wherever possible. Passing the happy-path demos alone is insufficient; the bad, empty, slow, and failed paths in the interface design are also acceptance targets.

### Gate 1 — Documentation and Scope Review

Before an implementation prompt is sent:

1. Confirm that this specification is consistent with the framing, description, and interface design.
2. Complete and cite the three goal-specific nutrition documents.
3. Confirm that every nutrition-related criterion traces to a named formula, range, threshold, bounded decision rule, and reference fixture in the three guidance documents.
4. Have a second review confirm that each success criterion has a true-or-false interpretation.
5. Commit the approved specification, research, validation plan, and agent context before implementation begins.

### Gate 2 — Deterministic Unit and Fixture Tests

Build tests around committed fixtures for:

- required-field completion and missing-field selection;
- catalog membership, selected-food enforcement, and meat/dairy meal rejection;
- researched target calculations and plan-total recalculation;
- weight parsing, unit normalization, duplicate prevention, trend calculation, and sufficient-evidence decisions;
- Draft creation, Draft replacement, approval binding, rejection, and Active Plan immutability before approval; and
- idempotent retry of every state-changing command.

Tests of researched calculations must include hand-calculated reference cases documented alongside the nutrition guidance. Approximate numeric comparisons must use explicit tolerances from that guidance rather than hidden rounding assumptions.

### Gate 3 — Structured AI Contract Tests

Use controlled or mocked model responses to verify that:

- valid multi-fact extraction updates all and only supported profile fields;
- an open question and a closed question produce the correct permitted interaction mode;
- unknown response types, arbitrary actions, invented catalog identifiers, prose where structured output is required, and malformed proposals are rejected;
- a Draft outside deterministic validation limits cannot activate; and
- an adjustment proposal cannot bypass the sufficient-evidence result or approval transition.

The verification suite must not rely on live model consistency for deterministic pass/fail results.

### Gate 4 — Interface and Race-Control Cases

Manually or through browser-level tests, verify:

- open question: text enabled, quick replies absent;
- closed question: quick replies visible, text disabled;
- Food Grid: grid enabled, chat input disabled;
- processing: all controls locked with visible feedback;
- rapid double-click and near-simultaneous submission: one accepted action;
- slow response: submitted action stays visible and cannot be duplicated;
- error and retry: confirmed state is preserved and retry is idempotent; and
- Draft/proposal versus Active labels remain unambiguous throughout approval and failure.

### Gate 5 — End-to-End Demo A

Run the New Demo Profile from its committed empty fixture and record a pass or fail for each step:

1. Provide multiple supported facts in one open answer.
2. Confirm multiple checklist updates and a next question limited to missing information.
3. Complete at least one closed question and verify the turn lock.
4. Complete all five Food Grid categories.
5. Generate a catalog-compliant, nutrition-valid Draft.
6. Request one supported change and confirm only the Draft changes.
7. Approve the Draft and confirm it becomes Active.

### Gate 6 — End-to-End Demo B

Run the Existing Demo Profile from its committed seeded fixture and record a pass or fail for each step:

1. Confirm the Active Plan and approximately two months of weights render on load.
2. Enter a new valid weight and confirm one new plotted measurement.
3. Confirm deterministic trend facts against the expected fixture result.
4. Exercise both insufficient-evidence and sufficient-evidence control fixtures.
5. For sufficient evidence, render a bounded proposal and confirm the Active Plan is unchanged.
6. Reject once and confirm no change; rerun, approve, and confirm the validated plan changes visibly.

### Gate 7 — Out-of-Scope Audit

Before accepting an implementation turn, inspect the application and dependency/tool configuration for accidental additions. Fail the gate if it introduces an extra profile flow, accounts, unrestricted runtime browsing, a general crawler, arbitrary AI tools, direct AI or source-adapter state mutation without explicit approval, or any feature listed as out of scope in the framing document. The only permitted verified runtime source interaction is the documented low-volume, server-owned USDA basic-food candidate flow.

## Part 5 — Known Pitfalls

- **Research rules treated as implementation suggestions:** The documented EER equations, goal rates, tolerances, evidence gate, and adjustment bounds are specification requirements. A coding agent may not replace them with remembered formulas or preferred fitness conventions.
- **AI prose instead of structured data:** A fluent response may fail the required contract. Reject it without parsing arbitrary prose into a state-changing action.
- **Invented nutrition facts or foods:** The model may name unsupported foods or quantities. Resolve every plan food through the approved catalog and recalculate totals deterministically. A requested missing item can enter only through the explicitly selected, source-labelled, validated, and approved catalog-addition flow.
- **Premature Draft generation:** Natural conversation can appear complete while required structured fields are missing. The checklist state, not the tone of the conversation, controls readiness.
- **Duplicate turn submission:** Animations, network latency, a quick-reply click, and keyboard input can race. Lock synchronously at the first accepted action and enforce idempotency below the UI.
- **Stale approval:** A user may approve a proposal after a newer Draft or Active Plan exists. Bind approval to the exact proposal and base plan version currently displayed.
- **Hidden Active Plan mutation:** A modification or adjustment may accidentally overwrite the Active Plan before approval. Store and render proposals separately until the transition succeeds.
- **Partial failure:** A weight can be stored successfully while later trend or AI processing fails. Preserve the confirmed measurement, report the later failure, and do not imply that an adjustment occurred.
- **Model timeout or invalid response:** Keep the submitted action and confirmed state visible, offer one safe retry, and prevent duplicate effects.
- **Live-model test instability:** Model wording and extraction can vary. Use mocks or recorded structured fixtures for contract tests and reserve live calls for a separate integration check.
- **Unit and rounding errors:** Weight units, catalog serving units, daily totals, percentages, and display rounding can disagree. Normalize before calculation and validate against explicit researched tolerances.
- **Seeded-date drift:** Relative “two months” fixtures can become misleading over time. Generate or maintain dated fixtures deterministically and test their ordering.
- **False trend confidence:** A chart may look persuasive when evidence is insufficient. The deterministic evidence rule controls proposal eligibility and the UI states that result plainly.
- **Kosher simplification leaking into a subsystem:** The constraint is limited to catalog curation and rejection of meat/dairy combinations within one meal. Do not add certification, waiting-time, kitchen, or inference features.
- **Open language mistaken for open capability:** The user may request unsupported medical advice, allergens, supplements, new goals, or arbitrary plan actions. Respond within the narrow product boundary without inventing a new command.
- **Source lookup mistaken for safe data:** A public source can be blocked, change markup, omit nutrients, or contain hostile text. Restrict it to one bounded synchronous candidate workflow, parse only expected fields, treat its content as untrusted data, record a controlled failure, and never let it write a catalog record without user approval.
- **Scope language mistaken for medical safety:** The product is a course demonstration for adults and excludes clinical nutrition. Its interface and claims must not present it as medical care or as handling conditions it does not support.

## Nutrition Rules Incorporated

The research phase resolved the previously open nutrition items in:

- [Fat Loss Nutrition Guidance](nutrition/fat-loss.md)
- [Maintenance Nutrition Guidance](nutrition/maintenance.md), including the shared EER, PAL, catalog, trend, and bounded-adjustment methods
- [Muscle Gain Nutrition Guidance](nutrition/muscle-gain.md)

Together they now define the exact structured inputs, 2023 EER equations, deterministic PAL heuristic, goal energy rules, protein targets, AMDR and fiber validation, ±5% plan-energy tolerance, 28-measurement evidence gate, ordinary-least-squares trend, goal-specific weekly rate bands, 5% bounded energy adjustment, catalog source method, serving normalization, and reference arithmetic fixtures.

The nutrition rules remain unchanged by Turn 4. Runtime foods must pass the same catalog, portion, macro, fiber, energy, and meal-classification checks as baseline foods; an omitted source fiber value remains unknown and contributes nothing to the deterministic fiber minimum.
