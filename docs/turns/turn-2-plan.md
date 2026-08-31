# Turn 2 Plan — Closed Catalog and Draft-to-Active Plan

Status: Authorized on 2026-08-30. Planning and catalog-source decisions are fixed before behavior changes.

Branch: `turn-2-catalog-and-plan`

Restore point: merge commit of accepted Turn 1 on `main`.

## Scope

Turn 2 completes the New Demo Profile story from the dedicated Food Grid through one validated repeatable-day Draft, one of the two supported Draft modifications, and explicit activation or rejection. It adds:

- one local, pre-reviewed food catalog;
- five Food Grid categories with catalog-ID persistence;
- deterministic gram-based nutrition arithmetic and complete-plan validation;
- strict structured Draft and Draft-modification AI boundaries;
- separate Draft and Active Plan state; and
- version-bound approval, rejection, retry, and stale-command protection.

Turn 2 does not add weight entry, trend calculation, adjustment proposals, plan history, goal switching, authentication, runtime food lookup, or any Turn 3 behavior. The Existing Demo Profile remains an honest foundation view.

## Criterion Mapping

- Product: SC-12 through SC-25 and the applicable SC-34 through SC-38 controls.
- Deterministic controls: VT-06 through VT-14.
- AI controls: AI-05, AI-06, and AI-08 for Food Grid and plan contracts.
- Interface controls: UI-03 through UI-06, UI-09, and UI-10.
- End to end: Demo A through valid Draft modification and activation.

## Catalog Authoring Decision

The runtime catalog contains only the following 16 foods. USDA FoodData Central is the nutrition source; retrieval occurred on 2026-08-30. The app stores the selected FoodData Central record, dataset/release, preparation state, per-100 g energy/protein/carbohydrate/fat/fiber, and an explicit display-portion gram conversion.

### Carbohydrates

1. Dry rolled oats — SR Legacy FDC `173904`.
2. Cooked white long-grain rice — SR Legacy FDC `168878`.
3. Baked sweet potato flesh — SR Legacy FDC `168483`.

### Proteins

1. Roasted skinless chicken breast — SR Legacy FDC `171477`, meal class `meat`.
2. Cooked Atlantic salmon — SR Legacy FDC `175168`, meal class `neutral` for the project's narrow meat/dairy rule.
3. Firm tofu — SR Legacy FDC `172448`, meal class `neutral`.
4. Plain nonfat Greek yogurt — SR Legacy FDC `170894`, meal class `dairy`.

### Fats

1. Olive oil — SR Legacy FDC `171413`.
2. Raw avocado — SR Legacy FDC `171705`.
3. Dry-roasted almonds — Foundation Foods FDC `323294`.

### Vegetables

1. Raw broccoli — Foundation Foods FDC `747447`.
2. Raw mature carrots — Foundation Foods FDC `2258586`.
3. Mature spinach — Foundation Foods FDC `1999633`.

### Fruits

1. Raw ripe banana — Foundation Foods FDC `1105314`.
2. Raw Fuji apple with skin — Foundation Foods FDC `1750340`.
3. Raw blueberries — SR Legacy FDC `171711`.

Foundation Foods is preferred where it supplies every required project nutrient and a usable gram basis. SR Legacy is used for a required preparation state or when the corresponding Foundation record lacks one of energy, protein, carbohydrate, fat, or fiber. For Foundation records without nutrient `1008`, the catalog records USDA's food-specific Atwater energy (`2048`) and names that choice in its metadata. No source file, API key, or lookup code is shipped to the browser or used at runtime.

The kosher simplification is manual curation only: every item is marked `kosherCatalogApproved: true`; non-kosher food is absent; and the meal validator rejects a `meat` plus `dairy` combination. No certification, waiting-time, kitchen, or inference feature is added.

## Food Grid Decisions

- The five required category groups are always visible in one dedicated conversational step.
- Each category must contain at least one selection before submission. Selecting more than one is optional and gives the Draft generator more flexibility.
- Cards use the catalog display name, practical preparation label, and category; they do not add health claims or micronutrient scoring.
- Submission sends only catalog IDs. Deterministic code rejects unknown IDs, duplicate IDs, wrong-category placement, or a missing category.
- On valid submission, the profile's approved IDs are replaced atomically, food-preference progress completes, targets recalculate, and Draft generation becomes available.
- Text input and unrelated controls remain disabled during grid selection and submission.

## Plan Shape and Validation

- `MealPlan` represents exactly one repeatable day and follows the accepted meal pattern: three meals, three meals plus one snack, or four meals.
- Every item is `{ catalogFoodId, grams }`; grams must be finite, positive, within the catalog's practical bounds, and use the catalog's gram step.
- A meal may include several items. It must never contain both a `meat` and a `dairy` classification.
- Optional alternatives are attached to one plan item and contain two or three total interchangeable choices. Each complete-day substitution is validated independently before display.
- Deterministic code owns catalog resolution, approved-food enforcement, per-portion arithmetic, daily totals, energy tolerance, goal protein range, age-appropriate AMDR percentages, fiber minimum, meal count, meal composition, and alternative validation.
- A Draft is approvable only when every validation issue list is empty. Validation failures are retained as controlled failures and never produce an Active label or mutation.

## AI Boundaries

### Draft generation

`POST /api/coach/draft` receives the completed profile, deterministic target snapshot, accepted meal pattern, and only the approved local catalog subset. The OpenAI Responses API returns strict JSON containing catalog IDs, gram portions, optional closed alternatives, and a short explanation. The request uses `store: false`, `tools: []`, and `tool_choice: "none"`. Code validates the schema, recalculates everything, and performs at most one repair attempt before returning a controlled retryable failure.

### Draft modification

`POST /api/coach/draft-modification` receives the current Draft, one free-text request, the approved catalog subset, and only these allowed actions:

1. `replace_food` — replace one existing plan item with one approved catalog item and a gram amount.
2. `change_portion` — change the grams of one existing plan item.

The endpoint may instead return `unsupported`. Application code applies an allowed operation to a copy and revalidates the whole day. The current Draft stays visible on any failure; an Active Plan is never written by either AI endpoint.

No live-model response is required for deterministic acceptance. Contract tests use fixed valid and malformed responses. A missing API key produces an honest retryable error and preserves confirmed state.

## Draft and Active State Rules

- The first generated proposal has `basePlanVersion: null`.
- Every successful modification creates a new proposal ID and plan version while leaving the Active Plan untouched.
- Rejecting a Draft removes only the pending proposal; it does not invent or restore plan history.
- Approval accepts only the exact currently displayed, valid proposal ID and matching base Active version.
- Duplicate approval is idempotent. A stale proposal ID or base version is rejected.
- Successful approval creates the Active Plan once, clears the Draft, and renders a persistent `Active Plan` label.

## Test and Control Cases Before Acceptance

1. Catalog arithmetic, source fields, category coverage, approved-ID rejection, practical gram bounds, and rounding.
2. Meat/dairy rejection and neutral/single-class meal acceptance.
3. All three goal validators, including energy, protein, AMDR, fiber, and alternative substitution controls.
4. Food Grid completion, incomplete-category feedback, local persistence, typing lock, double submission, and reset.
5. Strict Draft and modification schemas: valid candidate, prose, malformed JSON, unknown action, unknown food, wrong meal count, invalid grams, one repair, repeated failure, and timeout.
6. Draft/Active reducer controls: generation failure preservation, supported modification, unsupported request, rejection, exact approval, duplicate approval, and stale approval.
7. Browser Demo A from completed onboarding through Food Grid, Draft review, one supported modification, and activation, with mocked same-origin AI responses.
8. Scope/security scan proving no runtime food request, new profile, authentication, arbitrary action, secret, or Turn 3 surface was added.

## Planned Implementation Sequence

1. Add the reviewed local catalog and source record, then unit-test its closed schema.
2. Add plan contracts, arithmetic, validation, and deterministic fixtures with VT-06 through VT-14 tests.
3. Extend persisted state and reducer commands for Food Grid, Draft, modification, rejection, and activation.
4. Add strict server-only Draft and modification boundaries and contract fixtures.
5. Replace the Turn 1 Food Grid placeholder and plan empty state with the complete interaction and feedback design.
6. Add browser Demo A controls, run the complete verification registry, visually inspect desktop and mobile, and record evidence.

## Stop Conditions

Stop rather than broaden the product if a change would require runtime browsing, a second food source, an unreviewed nutrient value, a third modification action, meal-plan history, weight behavior, a new profile, allergy handling, goal switching, or direct AI mutation of an Active Plan.
