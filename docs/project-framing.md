# Project Framing v0.1

Status: Approved for the documentation phase

## Problem Statement

### Beginner Nutrition Planning Problem

A person who exercises but has little knowledge of nutrition may know that eating appropriately is important for reaching a fitness goal, while lacking the knowledge required to determine how much to eat, construct a practical meal plan, and recognize when that plan should change as body weight changes over time.

The problem is not only creating an initial plan. The user also lacks a simple way to translate ongoing weight measurements into informed adjustments without having to learn nutrition planning themselves.

## Stakeholders

- **Primary user:** An adult (18+) who exercises and is a beginner in nutrition.
- **Project owner/operator:** The student building and demonstrating the application.
- **Course evaluator:** The instructor, who must be able to observe and verify the two core demonstration scenarios and inspect their engineering trail in the repository.

## Definition of Done

The project is done when all of the following statements are true:

1. The application contains exactly two selectable demonstration profiles: **New Demo Profile** and **Existing Demo Profile**. It does not provide registration, authentication, or creation of additional profiles.
2. The New Demo Profile begins with no nutrition profile or meal plan and can complete onboarding through the conversational interface.
3. The coach can extract multiple required profile facts from one free-text answer, visibly mark collected information as complete, and continue asking only for required information that is still missing.
4. Closed questions are presented as quick replies inside the conversation. While they are active, text input is disabled, and exactly one answer can be submitted for that turn.
5. Open questions accept free-text input.
6. The food-preference stage presents one predefined food catalog as selectable grids grouped by carbohydrate, protein, fat, vegetable, and fruit categories.
7. The system can calculate initial nutritional targets for one supported goal: **Fat Loss**, **Maintenance**, or **Muscle Gain**.
8. The system can produce a Draft Meal Plan using only foods approved during food selection and nutritional values stored in the predefined catalog.
9. The Draft contains practical food quantities and two or three interchangeable choices where appropriate, and its calculated values fall within the acceptance ranges defined by the project's researched nutrition guidance.
10. The user can request a supported modification through the conversation and see the Draft change.
11. The user can approve the Draft and see it become the Active Plan.
12. The Existing Demo Profile loads with approximately two months of seeded weight measurements and an existing Active Plan.
13. A new weight measurement can be entered through the conversation and immediately appears in the weight-progress visualization.
14. Deterministic code calculates the weight trend and whether sufficient tracking evidence exists for a plan adjustment.
15. When sufficient evidence exists, the AI can use the calculated facts and the relevant nutrition guidance to propose an adjustment.
16. An adjustment never modifies the Active Plan until the user explicitly approves it; after approval, the updated Active Plan is visibly rendered.

Nutrition formulas, target rates, acceptance ranges, and adjustment thresholds are intentionally not repeated in this framing document. They are established and cited in the goal-specific nutrition guidance and incorporated into the product specification.

## Out of Scope

The project deliberately does not include:

- Authentication, registration, authorization, account management, or a general multi-user system.
- Real users or profiles beyond the two predefined demonstration profiles.
- Allergies, intolerances, medical conditions, clinical nutrition, or related safety screening.
- Runtime internet food search, foods outside the predefined catalog, or tools that allow the AI to browse or access unrestricted external systems.
- Workout programming or workout tracking.
- Food-intake or adherence tracking.
- Micronutrient calculation or optimization.
- Hydration tracking.
- Supplement recommendations. Protein powder may exist only as an ordinary predefined catalog food.
- Target-weight planning.
- Goal switching after onboarding.
- Meal-plan history or version browsing.
- Long-term chat-memory infrastructure.
- Weekly meal-plan variation; the product demonstrates one repeatable daily plan.
- Complex mathematical meal-plan optimization.
- Arbitrary AI actions, open-ended tool use, or comprehensive handling of arbitrary nutrition requests.
- A kashrut subsystem. For project simplicity, the predefined catalog excludes non-kosher foods and generated meals do not combine meat and dairy.

## Demo Scenarios

These are the project's two and only two end-to-end demonstration scenarios. A proposed capability should be excluded unless it materially supports one of them or is required to make one of them reliable.

### Demo A — New Demo Profile

1. Select **New Demo Profile**, which has no stored nutrition profile or meal plan.
2. Begin adaptive conversational onboarding.
3. Provide several facts in one free-text response and see the corresponding checklist items marked complete.
4. Continue through open questions and closed-question quick replies while the coach asks only for missing required information.
5. Open the food-preference grid and approve foods from the five catalog categories.
6. Return to the conversation, complete any missing information, and calculate initial nutrition targets.
7. Generate a Draft Meal Plan from approved catalog foods.
8. Request one supported change through the conversation and see the Draft update.
9. Approve the Draft and see it become the Active Plan.

### Demo B — Existing Demo Profile

1. Select **Existing Demo Profile**, which already has a completed profile, an Active Plan, and approximately two months of seeded weight measurements.
2. View the Active Plan and weight-progress visualization.
3. Report a new weight through the conversation.
4. See the new measurement added to the visualization.
5. Let deterministic code calculate the weight trend and whether enough evidence exists to consider an adjustment.
6. When supported by the calculated evidence, receive an AI adjustment proposal grounded in the applicable nutrition guidance.
7. Approve the proposal and see the Active Plan change visibly; without approval, the current plan remains unchanged.
