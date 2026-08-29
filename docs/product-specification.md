# Product Specification v0.1

Status: Draft; complete as a product-behavior specification, but **not implementation-ready** until the nutrition-research dependencies listed below are resolved and reviewed.

This specification is governed by [Project Framing](project-framing.md), [Project Description](project-description.md), and [Interface Design](interface-design.md). If a future interpretation expands the product beyond those documents, the narrower documented scope wins until the specification is deliberately revised.

## Part 1 — Goal and Reason

### Goal

Build a narrow demonstration application containing exactly two predefined profiles in which a conversational nutrition coach:

- adaptively collects the information needed for a beginner's nutrition plan;
- builds one repeatable daily meal plan from a closed, predefined food catalog;
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

Each criterion must produce a clear pass or fail result. Criteria marked **Research-dependent** cannot pass until the corresponding nutrition specification supplies reviewed values and methods.

### Demonstration Boundary

- **SC-01 — Exactly two profiles:** The entry view offers only **New Demo Profile** and **Existing Demo Profile**. It offers no registration, authentication, new-profile creation, or account management.
- **SC-02 — Fixed goals:** Goal selection offers only **Fat Loss**, **Maintenance**, and **Muscle Gain**. After onboarding, the selected goal cannot be changed.
- **SC-03 — Closed action space:** Every state-changing user action maps to one supported application action. Free text cannot cause browsing, catalog mutation, arbitrary tool use, or an unrecognized state transition.

### New Demo Profile and Adaptive Onboarding

- **SC-04 — Empty starting state:** Selecting New Demo Profile loads no completed nutrition profile, no Draft, and no Active Plan, then displays the first onboarding message and the visible completion checklist.
- **SC-05 — Multi-fact extraction:** Given one supported free-text response containing at least three required profile facts, the system stores all correctly recognized facts in the structured profile during the same turn and marks the matching checklist items complete.
- **SC-06 — Ask only for missing information:** After processing an answer, the next onboarding question requests information that is still required and does not ask again for a valid fact already stored.
- **SC-07 — Open-question behavior:** When the active question is open, free-text input is enabled and no quick-reply control is presented.
- **SC-08 — Closed-question behavior:** When the active question is closed, predefined quick replies appear inside the conversation and free-text input is disabled.
- **SC-09 — One action per turn:** After a quick reply, text submission, or Food Grid submission, every control for that turn locks immediately. Repeated clicks or simultaneous submission attempts result in exactly one accepted action and one user-message entry.
- **SC-10 — Processing lock:** While the system processes a user action, all input controls are disabled and visible progress feedback is present.
- **SC-11 — Required profile fields:** A Draft cannot be requested until the structured profile contains age, biological sex, height, current weight, one supported goal, sufficient daily-routine and movement information, exercise type, exercise frequency, approximate session duration, an accepted meal pattern, and completed food preferences.

### Closed Food Catalog and Preference Grid

- **SC-12 — Five catalog categories:** The Food Grid exposes selectable catalog foods grouped as carbohydrates, proteins, fats, vegetables, and fruits.
- **SC-13 — Selected-food persistence:** Submitting a valid Food Grid selection stores the chosen catalog identifiers as the profile's approved foods and visibly completes food preference progress.
- **SC-14 — Catalog-only behavior:** A food absent from the predefined catalog is not stored, assigned nutrition values, searched for, or added. The conversation requests a supported alternative.
- **SC-15 — Shared source of food truth:** The preference grid and plan calculations use the same catalog entries and nutritional values; no second runtime food source is consulted.
- **SC-16 — Kosher simplification:** Every catalog item used by the application is from the pre-reviewed kosher-oriented catalog, and deterministic validation rejects a meal containing both meat and dairy classifications. No separate kashrut workflow or inference system is present.

### Targets and Draft Meal Plan

- **SC-17 — Deterministic target calculation (Research-dependent):** Given a completed profile fixture, deterministic code produces the expected initial energy and nutrition targets using the cited method and rules for the profile's goal.
- **SC-18 — No premature target calculation:** If a required target-calculation input is missing or invalid, no targets or Draft are created and the missing or invalid input is identified.
- **SC-19 — Catalog and preference compliance:** Every food in a generated Draft references an existing catalog item approved for that profile.
- **SC-20 — Practical daily plan:** The Draft represents one repeatable day, uses practical quantities and units, and offers two or three interchangeable choices only where specified by the plan structure.
- **SC-21 — Nutrition acceptance (Research-dependent):** Deterministic recalculation of the Draft falls within every acceptance range defined by the applicable goal's nutrition specification.
- **SC-22 — Failed validation cannot activate:** A Draft that fails catalog, meal-composition, or nutrition validation is not presented as valid and cannot become Active.
- **SC-23 — Supported Draft modification:** A supported conversational change creates a new validated Draft rendering while leaving any current Active Plan unchanged.
- **SC-24 — Explicit activation:** Selecting the dedicated approval action for a valid Draft promotes that exact Draft to Active and renders it with an **Active Plan** label.
- **SC-25 — Decline preserves state:** Declining activation or requesting another change does not replace the current Active Plan.

### Existing Demo Profile and Weight Adjustment

- **SC-26 — Seeded existing state:** Selecting Existing Demo Profile loads one completed structured profile, one Active Plan, and approximately two months of dated seeded weight measurements without requiring historical chat messages.
- **SC-27 — Weight entry validation:** A valid conversational weight entry is normalized to the supported unit representation, stored exactly once with its date, and rendered in the weight visualization. An invalid entry is not stored or plotted.
- **SC-28 — Deterministic trend:** For a fixed weight-history fixture, deterministic code returns the expected trend facts and the expected sufficient-evidence result without consulting the AI.
- **SC-29 — Insufficient evidence (Research-dependent):** When the researched evidence rule is not met, no evidence-based caloric adjustment proposal is created and the Active Plan remains unchanged.
- **SC-30 — Sufficient evidence proposal (Research-dependent):** When the researched evidence rule is met, the AI receives the structured profile, current Active Plan, deterministic trend facts, and guidance for the fixed goal, and may return only a bounded adjustment proposal.
- **SC-31 — Proposal remains Draft:** Rendering an adjustment proposal does not change the Active Plan or label the proposal as active.
- **SC-32 — Adjustment approval:** Approving a valid adjustment proposal replaces the Active Plan with the validated proposed plan and visibly renders the change.
- **SC-33 — Adjustment rejection:** Rejecting or ignoring a proposal leaves the Active Plan unchanged.

### Failure, Recovery, and Scope

- **SC-34 — Failure preserves confirmed state:** A failed message, Draft, weight-recording, trend, proposal, or approval operation never claims or renders a state change that the deterministic store did not confirm.
- **SC-35 — Retry is idempotent:** Retrying the same failed action cannot create duplicate chat actions, weight records, activations, or adjustment approvals.
- **SC-36 — Invalid AI contract:** AI output that does not match an allowed structured response is rejected before it can render controls or mutate application state.
- **SC-37 — No unsupported product surfaces:** The demonstrable interface contains no authentication, additional-user management, allergies or intolerances, workout tracking, adherence tracking, hydration, micronutrient optimization, supplement recommendation workflow, target weight, goal switching, plan history, weekly plan variation, or internet food search.
- **SC-38 — No unapproved Active Plan mutation:** Across all validation and error cases, the Active Plan changes only after a valid, explicit approval action tied to the currently displayed Draft or adjustment proposal.

## Part 3 — Architectural Guidance

Keep the implementation boundary small: a chat-and-state interface communicates with an application layer that owns structured profile, catalog, plan, and weight state. Deterministic modules own all nutrition arithmetic, catalog validation, weight-trend calculations, evidence thresholds, idempotency, and Draft-to-Active transitions; the language model receives narrow structured context and returns only validated response types. The model has no browser, runtime food lookup, unrestricted tool access, or direct write path to the Active Plan or weight history.

Use one predefined Food Catalog as the sole source for preference choices and nutritional values. Keep exactly two deterministic demo-state fixtures, and derive the Existing Demo Profile from structured seeded data rather than simulated long-term chat memory. Preserve clear Draft and Active Plan representations so every proposal is reversible until an explicit approval command succeeds.

Implementation-specific frameworks, filenames, component trees, database choices, and internal function names are intentionally left to the later implementation plan, provided they preserve these boundaries.

### Required Structured Contracts

The implementation plan must define and validate narrow contracts equivalent to the following concepts without expanding the action set:

- A structured demo profile and onboarding-completion state.
- An assistant message with either no interaction, one predefined quick-reply set, or the dedicated Food Grid step.
- A catalog-backed Draft Meal Plan and an Active Plan.
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
3. Replace every Research-dependent rule with a named formula, range, threshold, or bounded decision rule.
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

Before accepting an implementation turn, inspect the application and dependency/tool configuration for accidental additions. Fail the gate if it introduces an extra profile flow, authentication, runtime browsing, an external food lookup, arbitrary AI tools, direct AI state mutation, or any feature listed as out of scope in the framing document.

## Part 5 — Known Pitfalls

- **Specification gaps disguised as implementation freedom:** Nutrition formulas, goal rates, tolerances, and adjustment bounds are currently unresolved dependencies, not choices for the coding agent.
- **AI prose instead of structured data:** A fluent response may fail the required contract. Reject it without parsing arbitrary prose into a state-changing action.
- **Invented nutrition facts or foods:** The model may name unsupported foods or quantities. Resolve every food through the predefined catalog and recalculate totals deterministically.
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
- **Scope language mistaken for medical safety:** The product is a course demonstration for adults and excludes clinical nutrition. Its interface and claims must not present it as medical care or as handling conditions it does not support.

## Nutrition-Research Dependencies Before Implementation

The following items must be defined in cited, goal-specific nutrition documents and then incorporated into this specification before it can be approved for implementation:

- the initial energy-estimation method and the exact structured inputs it requires;
- goal-specific energy adjustment rules for Fat Loss, Maintenance, and Muscle Gain;
- protein, fat, carbohydrate, fiber, and any other in-scope target rules;
- acceptable plan tolerances and rounding behavior;
- goal-specific expected weight-trend ranges;
- the minimum tracking duration, measurement count, and trend method required for sufficient evidence;
- bounded adjustment amounts or rules and conditions that forbid an adjustment;
- catalog data sources, serving-unit normalization, and validation tolerances; and
- hand-calculated reference fixtures for target, plan-total, trend, and adjustment tests.

Until these dependencies are approved, an agent may plan data shapes and interfaces but must not implement, guess, or select the nutrition rules.
