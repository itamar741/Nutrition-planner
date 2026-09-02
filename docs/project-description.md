# Project Description v0.2

## Product Summary

The product is a conversational nutrition coach for adults aged 18 and older who exercise but are beginners in nutrition. It helps a user provide the information needed for a practical meal plan, choose foods from a curated catalog, activate a plan, and understand when weight progress may justify a plan adjustment.

The coach supports exactly three fixed goals: **Fat Loss**, **Maintenance**, and **Muscle Gain**. It is a narrow course demonstration rather than a production health platform or a general nutrition assistant.

## Demonstration Model

The application contains exactly two predefined profiles:

- **New Demo Profile:** starts without a completed profile or meal plan and demonstrates onboarding, food selection, Draft creation, conversational modification, and activation.
- **Existing Demo Profile:** starts with a completed profile, an Active Plan, and approximately two months of seeded weight measurements and demonstrates weight entry, deterministic trend analysis, an AI adjustment proposal, and approval before change.

There are no accounts, additional users, or profile-management flows. Selecting a demo profile loads its predefined state.

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

The plan generator may use only catalog foods approved for the profile. A user can request a missing food or packaged product through the coach conversation on any workspace screen. This is a bounded addition workflow:

1. The application checks the central catalog first.
2. If the item already exists, the coach offers one explicit **Add to my foods** action; it does not perform an external lookup.
3. If preparation state or display unit is material and missing, the coach asks one short clarification question.
4. The Next.js server uses the bounded ScrapingBee adapter synchronously to search the public Fuder interface for foods and packaged products only. Recipes, restaurant items, and composite dishes are excluded.
5. The user chooses an explicit result when more than one match is available.
6. The application shows a source-labelled nutrition proposal and requires **Approve** or **Reject** before any catalog write.
7. Approval adds the item to the central catalog and to the current profile's approved foods. A later plan change remains a Draft until separately approved.

If Fuder is unavailable, blocked, malformed, or has no suitable result, the coach may show a clearly labelled `AI estimate · Fuder not verified` proposal. It still requires the same explicit approval. The model never treats an estimate as source-verified data.

For project-level kosher simplification, non-kosher foods are absent from the catalog and a single meal does not combine meat and dairy. This is a catalog and meal-composition constraint, not a general kashrut system.

## Nutrition Targets and Meal Plan Lifecycle

Initial energy and nutrition targets are calculated by deterministic code using the cited EER and goal rules in the project's nutrition guidance. The product does not ask the user to choose an abstract activity-level label; it gathers concrete routine and exercise information used by the deterministic PAL-category heuristic.

The product creates one practical daily meal plan intended to repeat rather than a varied weekly schedule. Quantities use understandable units such as grams, eggs, or containers. Relevant meal components may offer two or three interchangeable choices. Deterministic validation checks the plan against the energy, protein, age-appropriate AMDR, fiber, catalog, and meal-composition ranges defined in the nutrition guidance.

The plan lifecycle is deliberately small:

1. A generated plan begins as a **Draft Meal Plan**.
2. The user may request a supported Draft modification through the conversation.
3. The modified Draft remains separate from the current Active Plan.
4. Only explicit user approval promotes the Draft to the **Active Plan**.

There is no plan-history interface and no automatic activation.

## Existing Profile and Weight Adjustment

The Existing Demo Profile contains deterministic seeded state: a completed profile, one Active Plan, and approximately two months of dated weight measurements. It does not depend on simulated long-term chat history.

The user reports a new weight through the conversation. Once the value is validated and recorded, it appears in the weight-progress visualization. Deterministic code—not the language model—calculates trend facts and decides whether the configured minimum evidence threshold has been met.

If evidence is sufficient, the AI receives the calculated facts, the structured profile, the current Active Plan, and only the nutrition guidance relevant to the profile's fixed goal. It may propose a bounded plan adjustment. The proposal is shown as a Draft change and has no effect on the Active Plan until the user approves it. Rejecting or ignoring the proposal preserves the current plan.

If evidence is insufficient, the coach states that no evidence-based caloric adjustment can yet be proposed. A supported food substitution may still be handled as a separate Draft change because it does not claim to respond to the weight trend.

## Division of Responsibility

Deterministic application code owns:

- Structured profile and plan state.
- Catalog membership and nutrition values.
- Target calculations and plan-total validation.
- Weight-entry validation, storage, trend calculations, and the sufficient-evidence decision.
- Draft and Active Plan transitions.
- Enforcement of one user action per turn and explicit approval before mutation.

The AI is limited to:

- Extracting supported onboarding facts from natural language.
- Asking for missing required information using either an open question or predefined quick replies.
- Creating or modifying a Draft within catalog and nutrition constraints.
- Recognizing a weight-reporting intent and passing the value to deterministic validation.
- Explaining calculated trend facts and proposing a bounded adjustment when deterministic code says enough evidence exists.
- Classifying a food-addition request, requesting only missing food context, and requesting one server-controlled lookup action from a closed action set.

The interaction follows two governing principles: **open language, closed actions** and **approved catalog data**. The AI cannot browse freely, introduce new action types, write to the database, directly mutate an Active Plan, or operate arbitrary tools.

## Deployed Runtime Architecture

The deployed product uses Render only:

- A **Render Web Service** hosts the Next.js application and its narrow API routes.
- The same Web Service performs the low-volume, bounded Fuder lookup synchronously through ScrapingBee. It is not a general crawler and fails cleanly on its bounded timeout.
- **Render PostgreSQL** persists both versioned demo states, conversations, the central catalog, lookup requests, candidate records, source metadata, command results, and rate-limit events.

The two profiles are deliberately shared and use optimistic versions; a stale browser reloads the latest state and asks the user to retry. The browser holds only temporary rendered state and a signed access cookie. The server never logs in to Fuder, bypasses access controls, crawls in bulk, or sends raw source HTML to the browser or model.

Each profile has an independent **Reset demo** control. Fresh reset restores only the empty onboarding seed. Existing reset restores only its prepared plan, conversation, and generated weight history. Runtime catalog foods and persistent rate-limit events survive both resets.
