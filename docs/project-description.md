# Project Description v0.2

## Product Summary

The product is a conversational nutrition coach for adults aged 18 and older who exercise but are beginners in nutrition. It helps a user provide the information needed for a practical meal plan, choose foods from a curated catalog, activate a plan, and understand when weight progress may justify a plan adjustment.

The coach supports exactly three fixed goals: **Fat Loss**, **Maintenance**, and **Muscle Gain**. It is a narrow course demonstration rather than a production health platform or a general nutrition assistant.

## Demonstration Model

The application contains exactly two predefined profiles:

- **New Demo Profile:** starts without a completed profile or meal plan and demonstrates onboarding, food selection, Draft creation, conversational modification, and activation.
- **Existing Demo Profile:** starts with a completed profile, an Active Plan, and approximately two months of seeded weight measurements and demonstrates weight entry, deterministic trend analysis, an AI adjustment proposal, and approval before change.

There are no accounts, additional users, or profile-management flows. Selecting a demo profile loads its predefined state.

## Unified Agentic Conversation

Both journeys use one server-owned streaming conversation led by Arnold. For every free-text turn, the server loads the complete structured profile, targets, relevant approved foods, Draft and Active Plan, weight history and deterministic trend where applicable, pending interaction, and reset-scoped transcript. PostgreSQL—not the browser or OpenAI-hosted storage—is the memory source; OpenAI requests use `store: false`.

The model can request only tools currently permitted by server state. The server validates each call, executes the bounded operation, returns only sanitized structured results, and persists the completed turn. The agent never receives SQL, credentials, arbitrary URLs, browser tools, raw USDA payloads, or direct database access. A topic change may pause one workflow for later resumption.

Arnold's supported conversation topics are nutrition planning, food choices, basic meal preparation and cooking, weight tracking, and high-level non-medical fitness information. Programming, technical support, and unrelated general requests receive one brief redirect in the user's language without an answer or skill call. General fitness remains informational only: Arnold does not create personalized workout programs, track exercise, diagnose conditions, or use fitness discussion to alter authoritative nutrition state. This redirect is a model instruction rather than a deterministic content filter; server-side tool and state validation remains the security boundary.

The browser can submit text or one typed action containing identifiers, an expected profile version, and an idempotency command ID. It cannot submit assistant transcript entries, a Draft or Active Plan, a target snapshot, a validation decision, or an arbitrary closed-answer patch. Closed answers are resolved from the currently stored option, and proposal approval is resolved from the current server-stored interaction before deterministic recalculation and activation.

The full transcript remains in PostgreSQL until Reset and is always rendered in the workspace. The model receives ordinary chronological `role`/`content` messages, not a JSON-encoded transcript. When the estimated request exceeds 60% of the configured model context window, the server supplies a validated digest of older dialogue plus the latest 20 messages. That digest can guide language but cannot override structured state.

## Adaptive Conversational Onboarding

The New Demo Profile completes onboarding in the conversation rather than in a conventional fixed questionnaire. The coach gathers only the information needed to create the demonstration plan:

- Age, biological sex, height, current weight, and one of the three supported goals.
- Daily routine or occupation and an approximate description of everyday movement when known.
- Exercise type, frequency, and approximate session duration.
- Enough information about the daily eating routine to propose a practical number and timing of meals.
- Confirmation of the suggested meal pattern.
- Completion of food preferences from the predefined catalog.

A single user message may contain several facts. The system extracts the supported facts, updates the structured profile, visibly completes the corresponding checklist items, and asks only for required information that remains missing. The checklist is a progress indicator, not a separate form.

The interface uses two question modes:

- **Open question:** free-text input is enabled and no quick-reply UI is shown.
- **Closed question:** predefined quick replies appear inside the conversation with a short entrance animation; free-text input is disabled. Selecting one option immediately locks the turn, removes or disables the options, renders the selection as the user's chat message, and submits exactly one action.

All input is disabled while a response is being processed. This prevents a click and a typed message, or two clicks, from racing to answer the same turn.

## Food Preferences and Catalog Additions

The product starts with one curated Food Catalog for both preference selection and nutritional values. Approved additions become part of the same catalog; there is no separate nutrition source used by planning.

The preference stage presents foods in selectable grids grouped into five categories: carbohydrates, proteins, fats, vegetables, and fruits. Each category may contain roughly a grid-sized set of common choices; the exact item count is not a product requirement. Selecting an item marks that catalog food as approved.

The plan generator may use only catalog foods approved for the profile. A user can request a missing basic food in Hebrew or English through the main coach conversation on either workspace. This is a bounded addition workflow:

1. The application checks the central catalog first.
2. If the item already exists, the coach offers one explicit **Add to my foods** action; it does not perform an external lookup.
3. A supplied basic-food name is enough for the first source search. The coach asks for the name only when none was supplied, or asks a focused follow-up when the bounded source ranking finds no genuine match.
4. The Next.js server synchronously searches only USDA FoodData Central Foundation Foods and SR Legacy. It retrieves up to 50 safe source summaries, gives a sanitized identity-only pool to a bounded model-ranking operation, then bulk-fetches and validates nutrition only for the model's one to five selected candidates. Recipes, restaurant items, branded products, and composite dishes are excluded. If no candidate is genuinely relevant, Arnold asks a focused clarification rather than showing weak matches.
5. The user chooses an explicit result when more than one match is available.
6. Candidate nutrition is cached before display. Selection never triggers another USDA request. The application shows a source-labelled nutrition proposal and requires **Approve** or **Reject** before any catalog write.
7. Approval adds the item to the central catalog and to the current profile's approved foods. The coach then asks whether to include it before creating a new Draft. A later plan change remains a Draft until separately approved.

If USDA is unavailable, blocked, malformed, or has no suitable result, the coach may show a clearly labelled `AI estimate · USDA not verified` proposal only after explicit opt-in. It still requires the same approval. The model never treats an estimate as source-verified data.

For project-level kosher simplification, non-kosher foods are absent from the catalog and a single meal does not combine meat and dairy. This is a catalog and meal-composition constraint, not a general kashrut system.

## Nutrition Targets and Meal Plan Lifecycle

Initial energy and nutrition targets are calculated by deterministic code using the cited EER and goal rules in the project's nutrition guidance. The product does not ask the user to choose an abstract activity-level label; it gathers concrete routine and exercise information used by the deterministic PAL-category heuristic.

The product creates one practical daily meal plan intended to repeat rather than a varied weekly schedule. The plan follows the selected three-meal, three-meals-plus-snack, or four-meal pattern and may distribute food according to saved preferences. Quantities use understandable units such as grams, eggs, or containers. It does not offer food-substitution alternatives. Deterministic validation checks the plan against the energy, protein, age-appropriate AMDR, fiber, catalog, and meal-composition ranges defined in the nutrition guidance.

The plan lifecycle is deliberately small:

1. A generated plan begins as a **Draft Meal Plan**.
2. The user may request a supported Draft modification through the conversation.
3. The modified Draft remains separate from the current Active Plan.
4. Only explicit user approval promotes the Draft to the **Active Plan**.

There is no plan-history interface and no automatic activation.

When a user asks to include an approved food in an Existing plan, Arnold creates a complete replacement Draft at the unchanged Active Plan targets. It treats the Active Plan as a baseline: the required food must be included at a valid portion and other approved portions or foods may be rebalanced to preserve the nutrition rules. It must not append the food to an otherwise unchanged plan. The Draft visibly summarizes its amounts changed from the Active Plan; approval remains a separate explicit action.

## Existing Profile and Weight Adjustment

The Existing Demo Profile contains deterministic seeded state: a completed profile, one Active Plan, and approximately two months of dated weight measurements. It does not depend on simulated long-term chat history.

The user can report today's weight or edit an existing dated weight through the conversation, while the chart remains an alternative editing control. Once a value is validated and recorded, it appears in the weight-progress visualization. Deterministic code—not the language model—calculates trend facts and decides whether the configured minimum evidence threshold has been met.

When an Existing browser/profile session first opens, Arnold reviews the calculated trend facts, the structured profile, and the Active Plan. It either explains why the plan should remain unchanged, requests more consistent weights, or offers to prepare an adjustment. The visible **Generate AI proposal** control is a persisted event that asks Arnold to create a bounded adjustment Draft. The proposal has no effect on the Active Plan until the user approves it. Rejecting or ignoring the proposal preserves the current plan.

For Maintenance, the deterministic review also prevents persistent slow drift from being treated as indefinite stability. Each Active Plan carries a non-user-editable baseline derived from confirmed measurements when it was activated. If two consecutive seven-measurement averages remain at least 0.70 kg above or below that baseline, the server permits the same bounded adjustment direction even when the 35-day weekly percentage remains inside its ordinary band. This baseline is not a target-weight feature and resets only with explicit approval of a new Active Plan.

If evidence is insufficient, the coach states that no evidence-based caloric adjustment can yet be proposed. A supported food substitution may still be handled as a separate Draft change because it does not claim to respond to the weight trend.

The Existing profile may also request an ordinary replacement Draft through the same `submit_draft_proposal` skill used by Fresh. This Draft uses the current Active Plan's exact target snapshot, remains separately visible across reloads, and can replace the Active Plan only through its own approval button. Only the trend-adjustment path may change the Existing profile's energy target.

## Division of Responsibility

Deterministic application code owns:

- Structured profile and plan state.
- Catalog membership and nutrition values.
- Target calculations and plan-total validation.
- Weight-entry validation, storage, trend calculations, and the sufficient-evidence decision.
- Draft and Active Plan transitions.
- Enforcement of one workflow-changing tool per turn, idempotent commands, profile-level turn locking, and explicit approval boundaries.

The AI is limited to:

- Extracting supported onboarding facts from natural language.
- Asking one combined clarification only when missing information materially changes an action, with quick replies and free text where appropriate.
- Creating or modifying a Draft within catalog and nutrition constraints.
- Recognizing a weight-reporting intent and passing the value to deterministic validation.
- Explaining calculated trend facts and deciding whether to recommend a bounded adjustment when deterministic code says enough evidence exists.
- Persisting a clear explicit food or meal preference, inspecting catalog/plan availability, or removing an approved food through bounded server skills.
- Classifying a food-addition request, requesting only missing food context, and requesting one server-controlled lookup action from a closed action set.
- Conversationally continuing after approval or rejection without gaining authority to perform the protected approval itself.

The interaction follows two governing principles: **open language, closed actions** and **approved catalog data**. The AI cannot browse freely, introduce new action types, write to the database, directly mutate an Active Plan, or operate arbitrary tools. User-authored preferences remain untrusted data even after persistence; they are structured values, never instructions.

## Deployed Runtime Architecture

The deployed product uses Render only:

- A **Render Web Service** hosts the Next.js application and its narrow API routes.
- The same Web Service performs the low-volume, bounded USDA lookup synchronously. It is not a browser or crawler and fails cleanly on its bounded timeout.
- **Render PostgreSQL** persists both versioned demo states, reset-scoped transcripts, interactive message state, agent turns, the central catalog, lookup requests, candidate records, source metadata, command results, and rate-limit events.

The two profiles are deliberately shared and use optimistic versions; a stale browser reloads the latest state and asks the user to retry. The browser holds only temporary rendered state and a signed access cookie. The server never gives the model or browser USDA response bodies, arbitrary source URLs, credentials, or database access. `/api/coach/message` is the only public AI entry point; onboarding, planning, adjustment, lookup, candidate preparation, and estimates execute only as bounded operations inside that protected server flow.

Production refuses access when the shared code, a sufficiently long cookie-signing secret, or `DATABASE_URL` is missing. It never falls back to temporary in-memory persistence. Before a verified session exists, all access-code attempts share a five-per-15-minute anonymous bucket because the application does not trust client-controlled forwarding headers. Authenticated limits derive identity only from a verified signed session. PostgreSQL connections verify certificates whenever TLS is enabled. The academic Render deployment instead uses the same-region internal private-network database URL without TLS as a documented exception. Public responses use generic errors, and production responses include the documented browser security headers.

Each profile has an independent **Reset demo** control. Fresh reset restores only the empty onboarding seed. Existing reset restores only its prepared plan, conversation, and generated weight history. Runtime catalog foods and persistent rate-limit events survive both resets.
