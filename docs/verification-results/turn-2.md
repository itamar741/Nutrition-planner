# Turn 2 Verification Result

> **Historical evidence:** These results apply only to the named Turn 2 commit. Direct Draft endpoints and browser-authoritative completion paths were superseded by Security Phases 2–3. Current controls and open live gates are documented in the [implementation plan](../implementation-plan.md) and [Phase 6 result](phase-6.md).

- Date: 2026-08-30
- Branch: `turn-2-catalog-and-plan`
- Implementation commit under test: `50a75258b4d4a4c87479816497ad93d80561d0fc`
- Historical result at the time of this record: automated gates passed; this file did not record a separate human acceptance. The branch was later merged and the implementation was superseded by the current server-owned architecture. This historical omission is not presented as a current deployment blocker.

## Scope Under Test

- SC-12 through SC-25 and the applicable SC-34 through SC-38 controls.
- VT-06 through VT-14.
- AI-05, AI-06, and AI-08 for Food Grid and plan contracts.
- UI-03 through UI-06, UI-09, and UI-10.
- Demo A from Food Grid selection through Draft modification and explicit activation.

Turn 3 weight entry, trend calculation, adjustment proposal, and Existing Profile behavior were not implemented or claimed.

## Automated Gate Result

Command: `npm run verify`  
Exit result: success  
Captured result: [turn-2-verify.txt](turn-2-verify.txt)

- Prettier: all matched files passed.
- ESLint: passed with zero warnings allowed.
- TypeScript and generated route types: passed.
- Vitest: 7 files and 38 tests passed.
- Next.js production build: passed; the three narrow coach API routes and application pages built successfully.
- Playwright Chromium: 9 scenarios passed, including all retained Turn 1 scenarios and 4 Turn 2 scenarios.

The Turn 2 tests cover catalog completeness and arithmetic, unknown and unapproved food rejection, practical gram rules, all three supported goals, energy/protein/AMDR/fiber validation, meat-and-dairy rejection, alternative validation, strict structured AI contracts, one bounded repair, failure preservation, reducer idempotency, stale and duplicate approval protection, incomplete Food Grid feedback, mobile layout, Draft rejection, supported modification, and exact explicit activation.

## Catalog and Deterministic Authority

- The runtime catalog is a closed local list of 16 foods across the five required categories.
- Every record stores its USDA FoodData Central identifier, dataset/release, retrieval date, preparation state, per-100 g nutrients, gram conversion, and practical gram rules.
- No USDA download, API key, lookup client, browser tool, or food-search path is shipped at runtime.
- Application code—not the model—resolves catalog IDs, calculates nutrients, validates the full day and alternatives, enforces the meat/dairy rule, owns versions, and performs Draft-to-Active transitions.

The reviewed source record is preserved in [food-catalog.md](../nutrition/food-catalog.md).

## AI and Security Controls

- The browser can call only same-origin onboarding, Draft, and Draft-modification routes.
- The Draft boundary receives only the completed profile, deterministic targets, meal pattern, and approved catalog subset.
- The modification boundary allows exactly `replace_food` and `change_portion`, or an explicit unsupported result.
- Both OpenAI requests use strict structured schemas, `store: false`, `tools: []`, and `tool_choice: "none"`.
- Malformed or invalid output gets at most one repair attempt and cannot mutate confirmed state.
- A missing API key produces an honest retryable failure; no API key is exposed to browser code.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Scope scan found no authentication, runtime food lookup, arbitrary AI action, plan history, goal switching, or Turn 3 behavior.

## Visual and Interaction Review

Agent visual review passed for the primary Turn 2 states:

- [desktop Food Grid](turn-2-food-grid.png);
- [desktop validated Draft](turn-2-draft.png);
- [desktop Active Plan](turn-2-active.png); and
- [mobile Food Grid](turn-2-food-grid-mobile.png).

The Food Grid shows all five categories, keeps typing disabled, and requires category completion. Draft and Active labels are distinct. The modification control appears only for a Draft, and an Active Plan appears only after approval. The mobile grid uses normal page flow without a nested scrolling region.

The browser runner emitted only its environment-level `NO_COLOR` notice, which does not originate from application code or affect behavior.

## Live AI Check

No live-model smoke check was run because no user API key was used. This remains optional and is not a deterministic acceptance gate. Fixed contract fixtures cover valid responses, malformed JSON, unsupported actions, invalid catalog references, repair, timeout, and repeated failure.

## Human Review Gate at the Time of Turn 2

At the time this evidence was written, Gate 7 was still pending. The requested review was to select at least one food in every category, generate a Draft, request a supported portion or food replacement, reject or approve the exact displayed Draft, and confirm that only approval creates the persistent Active Plan.

The following were the contemporaneous stop instructions and are preserved as historical evidence rather than current instructions:

1. Keep the work on `turn-2-catalog-and-plan`.
2. Do not merge it to `main`.
3. Do not begin Turn 3.
