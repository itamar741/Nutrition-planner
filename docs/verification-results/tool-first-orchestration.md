# Tool-First Orchestration Verification

Date: 2026-09-28

Branch: `architecture/10-tool-first-verification`

Implementation chain:

- `6b896c0` — tool-first documentation and contracts
- `d235f02` — durable Plan Change state schema v3 and migration
- `3e01d75` — tool-first orchestration and skill handlers

## Outcome

The implementation meets the approved **open planning, closed effects** design.
Arnold receives the complete documented skill set on free-text turns and chooses
up to four sequential calls. The server does not classify intent, but it remains
authoritative for evidence, state prerequisites, catalog membership, persistence,
nutrition calculations, Draft validation, leases, and visible approvals.

The Active Plan remains separate from every Draft and changes only through the
visible Draft approval control. Model-generated meal quantities are accepted only
after deterministic server validation.

## Automated gates

- `npm run format:check` — pass
- `npm run lint` — pass with zero warnings
- `npm run typecheck` — pass
- `npm run test:unit` — pass, 33 files / 253 tests
- `npm run security:check` — pass, 177 project files scanned
- `npm run build` — pass
- `npm run test:e2e` — pass, 23 Chromium scenarios
- `npm run test:ai-live` — pass, 2 files / 10 tests
- `git diff --check` — pass

The first sandboxed E2E attempt could not launch Chromium because macOS denied
its Mach rendezvous port. The identical suite passed outside that restricted
sandbox. This was an execution-environment failure, not an application failure.

## Verified behavior

- `i want to add cottage cheese to my meal plan` selects `search_foods` with
  `integrate_into_plan`; food approval and Create Draft remain visible user
  decisions.
- `i dont like rice. any other oprions for my meal plan?` selects
  `offer_approved_food_alternatives` and excludes rice. No profile preference or
  Draft is created before the user chooses.
- A stored approved-alternative choice continues the same Plan Change through
  `submit_draft_proposal`; it is not confused with selecting a USDA search result.
- `i want to change the whole meal plan` submits a formal complete Draft rather
  than returning a prose-only menu.
- `different mix of approved foods` continues the existing failure-review
  operation with `different_approved_mix` and starts a new attempt batch.
- Hypothetical weight language, `Do not record this`, `Do not change my meal
plan`, and unsupported technical requests do not select a mutating skill.
- Multi-skill turns persist each completed mutation before the next call. A later
  failure cannot roll back an earlier completed skill.
- Draft validation requires approved IDs, complete expected meals, practical
  portions, required and excluded foods, nutrition ranges, and a material change
  when the operation requires one.
- Typed approval never activates a food, Draft, or adjustment; only the current
  visible button can cross that boundary.

## Findings resolved during live verification

The live model initially chose `select_food_candidate` for a stored approved-food
alternative. The skill contract now states that this tool is exclusive to a
current `food_candidates` interaction produced by search. An approved alternative
is carried by `submit_draft_proposal` continuation instead.

A later live run chose the correct Draft tool for a different-mix retry but marked
the operation as `new_request`. The schema and Arnold prompt now require the exact
active Plan Change ID whenever `pendingPlanChange` is present. The server also
returns a structured `blocked` result for a conflicting new request, so a model
mistake cannot silently replace the durable operation.

The old topic-boundary test for the rice sentence intentionally exposed no tools
and expected a prose list. That setup no longer represented the product contract
and was removed. The same exact sentence remains in the live tool-first matrix
with the complete skill set available.

## Residual limitation

Semantic skill choice and candidate meal composition remain model-dependent by
design. Live tests demonstrate the configured model behavior but cannot make it
mathematically deterministic. Wrong choices are bounded by strict schemas,
current-state checks, persisted Plan Change continuity, server calculations,
Draft validation, and protected approvals.

No deployment, push, pull request, or merge is claimed by this report.
