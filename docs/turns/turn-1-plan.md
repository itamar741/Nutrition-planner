# Turn 1 Plan — Foundation and Adaptive Onboarding

Status: Authorized on 2026-08-30; implementation branch `turn-1-onboarding-foundation`.

Restore point: `b43f93c` (`docs: add planning-only implementation plan`).

## Scope

Turn 1 implements only the foundation and adaptive-onboarding slice named in the approved implementation plan:

- pinned Next.js, React, and TypeScript project;
- deterministic profile validation, readiness, PAL, EER, and initial targets;
- exactly two predefined profile choices;
- the New Demo Profile onboarding workspace;
- open questions, closed quick replies, synchronous turn locking, slow/error/retry feedback, and checklist progress;
- one narrow server-side OpenAI onboarding endpoint using Structured Outputs and no tools; and
- unit, structured-contract, component, and browser acceptance controls for the Turn 1 criteria.

Turn 1 does not implement the Food Grid contents, meal-plan generation, Draft activation, weight tracking, trend analysis, or adjustment proposals. Those surfaces may display an honest later-turn placeholder only.

## Criterion Mapping

- Product: SC-01 through SC-11, SC-17, SC-18, and the Turn 1 portions of SC-34 through SC-38.
- Deterministic controls: VT-01 through VT-05.
- AI controls: AI-01 through AI-06 and AI-08.
- Interface controls: UI-01, UI-02, UI-04 through UI-07, UI-09, and UI-10 where a plan state exists.

## Fixed Turn Decisions

### Demo profiles

- Display names remain exactly **New Demo Profile** and **Existing Demo Profile**.
- New starts with an empty structured profile, the welcome turn, no selected foods, and no plan.
- Existing uses the shared reference facts: age 30, male equation, 180 cm, 80 kg, Maintenance, mostly seated routine, and 180 weekly resistance-training minutes. This maps deterministically to `low_active` and a 2,950 kcal Maintenance target. Catalog selections, Active Plan, and weight history are completed only in Turns 2 and 3.

### Language and tone

- Product UI and coach copy are English so the submitted course demo and specification terms match directly.
- Tone is calm, concise, practical, and non-clinical.

### Visual tokens

- Ink `#17211b`, muted ink `#5f6b63`, warm canvas `#f4f0e7`, paper `#fffdf8`.
- Primary green `#286548`, primary hover `#1f5139`, mint `#dcecdf`.
- Accent amber `#dc8b2b`, error `#a23b34`, border `#d7d8ce`.
- Rounded cards use 20–28 px radii, controls use 12–16 px radii, and shadows remain soft.
- Typography uses local system fonts to avoid an external runtime font request.

### OpenAI boundary

- `OPENAI_API_KEY` and `OPENAI_MODEL` are server-only; the example model is `gpt-5.4-mini` and can be changed through local configuration.
- The official TypeScript SDK calls `responses.create` with strict `json_schema` output, `store: false`, `tools: []`, and `tool_choice: "none"`.
- The model extracts only supported profile facts and returns short acknowledgement copy. Deterministic code merges validated facts, chooses the next missing field and interaction type, calculates targets, and controls all state changes.
- No hosted conversation, previous response ID, web search, file search, function tool, or arbitrary action is available.

## Implementation Sequence

1. Add package and tool configuration with a committed lockfile.
2. Add schemas, calculations, checklist/readiness, deterministic next-turn selection, reducer, fixtures, and local persistence.
3. Add the OpenAI client boundary and onboarding Route Handler.
4. Add the entry screen, onboarding workspace, quick replies, checklist, empty plan state, locking, and recovery feedback.
5. Add unit, contract, component, and Playwright controls before claiming acceptance.
6. Run the command registry, perform the scope/security audit, and write `docs/verification-results/turn-1.md` with the exact commit-under-test and results.

## Stop Conditions

Stop rather than broadening the design if Turn 1 would require a food catalog, a valid Draft/Active plan, a database, authentication, another profile, a runtime browsing tool, or a nutrition rule not already documented.
