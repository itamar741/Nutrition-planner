# Structured Turn Outcomes Verification

Date: 2026-09-30

Branch: `architecture/15-structured-turn-outcomes`

Parent: `architecture/14-food-workflow-isolation` at `0aee58f`

Base implementation: `1da79f7`

Capability-prompt follow-up: `efe249b`

## Reported failure

After a runtime egg was approved and the immediate Create Draft offer was
declined, the explicit requests `Generate my Draft Meal Plan` and
`add eggs to my meal plan` could finish as model prose without any skill call.
The server validated effects but did not validate whether a no-effect terminal
answer was appropriate, so a false topic-boundary redirect or an “already
active” answer was accepted and persisted.

## Implemented behavior

- Every free-text model round must select a stateful skill or a structured
  `answer_user`, `ask_clarification`, or `decline_out_of_scope` outcome.
- A separate schema-constrained contract review checks terminal outcomes against
  the latest request, authoritative context, and advertised capabilities before
  display.
- An invalid terminal choice is returned to Arnold as rejected; the review then
  forces the correct stateful skill, read-only answer, clarification, or boundary
  outcome on the next round.
- Hypothetical and explicitly negated weight language is rejected by
  deterministic tool-local evidence parsing, so a model selection error cannot
  write a measurement.
- `begin_plan_change` validates current-message evidence and approved food IDs,
  persists a durable `ready_for_draft` operation, and requires
  `submit_draft_proposal` next.
- The initializer plus three Draft attempts fit inside the existing limit of four
  stateful calls. Terminal review does not consume that stateful-call budget.
- Declining an immediate Create Draft offer ends that operation, while a later
  explicit text request can start a new operation for the already-approved food.

## Regression coverage

- A unit flow approves a runtime egg, seeds and declines its immediate Create
  Draft interaction, sends `add eggs to my meal plan`, and verifies a new Plan
  Change requiring that egg plus a mandatory Draft submission.
- The bounded-loop test verifies that an invalid “the plan is already active”
  terminal answer is rejected and `begin_plan_change` is forced.
- Bounded-loop coverage verifies that a blocked unsafe weight call continues to
  a reviewed read-only answer, while application coverage verifies that the
  handler leaves measurements unchanged.
- The live matrix now expects the exact advertised Draft prompt and an
  already-approved egg integration to select `begin_plan_change`, while the
  hypothetical and negated weight cases cannot complete a protected effect.
- The exact shared capability example `Find Eggs and add it to my foods` selects
  `search_foods` with catalog-only purpose and does not receive a topic-boundary
  redirect.

## Verification result

- Formatting, lint, typecheck, security scan over 190 project files, and the
  production build pass.
- The complete unit suite passes: 37 files / 281 tests.
- The browser suite passes: 26 Chromium scenarios.
- Credentialed live-model checks pass for the advertised Draft and TDEE prompts,
  runtime Egg integration, cottage- and cream-cheese resolution, catalog-only
  already-approved food handling, stored alternatives, different-mix retry,
  three-attempt Draft repair, explicit weight recording, non-mutating weight
  language, and the topic boundary.
- One full live-matrix invocation reached the provider TPM ceiling after 13
  passing cases. Every case reported in that run was rerun individually or in a
  focused group after cooldown and passed; the limit was external rather than a
  product assertion failure.

The four pre-existing Turn 2 PNG modifications remain outside this branch's
changes.
