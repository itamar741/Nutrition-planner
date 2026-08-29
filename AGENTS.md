# Nutrition Coach Project Context

## Current phase

This repository is in the documentation and verification-design phase. Do not create application code, dependencies, package manifests, database schemas, deployment configuration, or implementation prompts unless the user explicitly authorizes the implementation phase after reviewing the planning documents.

## Read first

Before proposing or changing work, read:

1. `docs/project-framing.md`
2. `docs/project-description.md`
3. `docs/interface-design.md`
4. `docs/product-specification.md`
5. `docs/nutrition/maintenance.md`
6. The goal-specific nutrition document relevant to the task
7. `docs/verification-plan.md`

The written specification wins over conversational memory. If documents conflict, stop and ask for clarification rather than selecting a broader interpretation.

## Product boundary

- Build only the two predefined demo profiles: New Demo Profile and Existing Demo Profile.
- Support only Fat Loss, Maintenance, and Muscle Gain; the selected goal never switches.
- Keep the Food Catalog local, predefined, catalog-only, and kosher-oriented. Do not browse, search the internet at runtime, invent food data, or add foods at runtime.
- Never add authentication, accounts, general multi-user support, allergies, intolerances, clinical nutrition, workout or adherence tracking, hydration, micronutrient optimization, supplements workflow, target weight, plan history, long-term chat memory, weekly plan variation, or arbitrary AI tools/actions.
- Keep meat and dairy out of the same meal. Do not build a kashrut subsystem.

## Deterministic authority

Application code—not the language model—must own profile state, catalog values, energy and macro calculations, plan validation, weight storage, trend calculations, evidence eligibility, idempotency, and Draft-to-Active transitions.

The language model may extract supported facts, choose an allowed question mode, draft catalog-backed plan changes, and explain deterministic results. It may not browse, invent nutrition values, write weight history directly, choose an unbounded calorie change, or modify an Active Plan directly.

Use the EER equations, PAL heuristic, age-appropriate AMDR ranges, protein targets, fiber minimum, trend bands, 28-measurement evidence gate, and 5% / 100–200 kcal adjustment bound exactly as documented. Do not substitute remembered nutrition formulas or fitness conventions.

## Interaction and safety invariants

- Open question: text input enabled; no quick replies.
- Closed question: quick replies enabled; text input disabled.
- Food Grid: grid enabled; text input disabled.
- Each turn accepts at most one user action. Lock controls immediately and keep them locked while processing.
- Every proposal remains Draft. Active Plan state changes only after explicit approval of the currently displayed valid proposal.
- Reject malformed AI output before it can render controls or mutate state.
- Preserve confirmed state on failures and make retry idempotent.

## Working protocol

- For every non-trivial implementation turn: update relevant intent/spec/context, commit a clean restore point, create a branch, then plan before editing.
- Treat `docs/verification-plan.md` as the acceptance contract. Add or update a test/control case before accepting behavior changes.
- Record verification evidence in versioned files; do not claim a test, demo, or review passed without its output or a documented human result.
- Keep commits atomic and use honest messages.
- Stop and ask before changing scope, nutrition rules, model/tool permissions, data sources, or any Active Plan approval invariant.

