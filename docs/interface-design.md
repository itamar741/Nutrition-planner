# Interface Design v0.1

This document specifies behavior and ordering rather than colors, typography, or pixels. It follows the Module 8 interface-design decisions: user flow, information hierarchy, interaction model, and feedback design, including slow, invalid, empty, and failed states.

## User Flow

### Entry and Profile Selection

1. The first view identifies the product as a conversational nutrition coach and offers exactly two choices: **New Demo Profile** and **Existing Demo Profile**.
2. Selecting a profile loads its predefined state and opens the coaching workspace.
3. No sign-up, sign-in, profile creation, or user-management path is shown.

### New Demo Profile Flow

1. Open an empty coaching conversation with the onboarding checklist visible.
2. Receive the next question in the chat.
3. Answer an open question with text or answer a closed question using one quick reply.
4. Parse the answer, update all supported facts found in it, visibly complete the relevant checklist items, and ask only for remaining required information.
5. When food preferences are required, insert the Food Grid as a dedicated interactive step in the conversation and disable text input.
6. Select approved foods across the five categories and submit the completed selection.
7. Return to the conversation and collect any remaining required information.
8. Calculate targets, generate a Draft Meal Plan, and render it in the plan area while keeping the conversation visible.
9. Let the user request a supported modification; show processing feedback and then render the changed Draft.
10. Present an explicit approval choice. Approval promotes the Draft to Active; declining or requesting another change leaves the Draft unactivated.

The system does not enable Draft generation when required information or food selection is incomplete. It identifies the missing requirement and returns the user to the relevant conversational step.

### Existing Demo Profile Flow

1. Open a populated workspace showing the Existing Demo Profile's Active Plan, weight history, and coaching conversation.
2. Let the user report a new weight in the chat.
3. Validate the value. If valid, record it and update the visualization before adjustment reasoning begins.
4. Calculate the trend and sufficient-evidence result deterministically.
5. If evidence is insufficient, explain that the Active Plan remains unchanged.
6. If evidence is sufficient, show the calculated trend summary and an AI adjustment proposal as a Draft change.
7. Ask for explicit approval using a closed-question quick reply.
8. Approval updates and renders the Active Plan. Rejection preserves the current plan.

An invalid weight value is not added to the chart. The conversation explains what is wrong and requests a corrected value.

## Information Hierarchy

The workspace prioritizes the user's current decision and current plan state over history or explanation.

1. **Current conversational turn:** the latest coach message and its active response control appear where the user is already looking.
2. **Current plan status:** Draft or Active is always visibly labelled. The interface must never make a proposal look active before approval.
3. **Primary task context:** during onboarding, this is the completion checklist; after planning, it is the rendered meal plan; during weight review, it is the trend visualization and calculated summary.
4. **Supporting detail:** nutrition totals, interchangeable choices, earlier messages, and historical measurements remain accessible but do not compete with the current decision.

For the New Demo Profile, the checklist and plan area change with the flow: the checklist is prominent while facts are missing; the Draft becomes prominent when it exists. For the Existing Demo Profile, the Active Plan and recent weight trend are visible on entry, with the conversation ready for a new measurement.

The approval decision is shown adjacent to the proposal it controls. The current Active Plan remains visible until approval succeeds, making the before-and-after state unambiguous.

## Interaction Model

The product uses only three conversation primitives:

- **Chat message:** displays coach or user text.
- **Chat message with quick replies:** presents a closed question with predefined choices inside the conversation.
- **Food Grid:** presents selectable predefined catalog foods during the dedicated preference step.

### Turn Rules

- An open question enables text input and shows no quick replies.
- A closed question enables quick replies and disables text input.
- The Food Grid disables text input and unrelated conversation actions until its current step is submitted or explicitly cancelled where cancellation is supported.
- Submitting any action immediately locks every control belonging to that turn.
- One turn accepts at most one user action.
- All input remains disabled while the system processes the action.
- A selected quick reply becomes a normal user message in the transcript so the conversation remains legible.
- The next set of controls is rendered only from a validated, narrow response type; the AI cannot request arbitrary widgets or actions.

### Plan and Adjustment Rules

- Draft generation, modification, activation, and adjustment approval are distinct actions.
- A conversational request may change only a Draft.
- Activating or replacing an Active Plan always requires a dedicated approval action.
- A weight message triggers deterministic value validation and trend processing; AI prose cannot write directly to weight history.
- Unknown foods are rejected with a catalog-alternative prompt rather than searched or guessed.

## Feedback Design

Feedback must make the current state, accepted action, and next available action clear.

### Normal Feedback

- Show a brief entrance animation when quick replies or the Food Grid becomes available; motion communicates availability and is not required to understand the control.
- Immediately show a selected quick reply or submitted text as a user message, then lock the turn.
- Mark newly collected checklist facts when they are successfully stored.
- Distinguish Draft and Active with persistent text labels, not color alone.
- After a weight is stored, update the plotted measurement and then show the calculated trend summary.
- Before approval, label an adjustment as a proposal and explain that the Active Plan has not changed.
- After approval, confirm the transition and visibly render the updated Active Plan.

### Loading and Slow States

- While a message, plan, or adjustment is processing, show an in-conversation progress indicator describing the current operation in plain language.
- Disable text input, quick replies, Food Grid controls, and approval controls until the operation resolves.
- Plan generation and modification use specific messages such as **Building your draft plan…** rather than a generic spinner with no context.
- If processing takes longer than expected, keep the user's submitted action visible and replace silent waiting with a delayed-state message. Do not allow duplicate submission.

### Empty States

- A New Demo Profile with no messages shows the coach's first onboarding message and an empty checklist state; it never presents a blank chat pane.
- Before a Draft exists, the plan area explains that a plan will appear after required onboarding and food selection are complete.
- If weight history is unavailable in a recoverable test state, the visualization area says that no measurements are available and does not imply a trend.
- No adjustment area is shown when there is no validated proposal.

### Bad or Invalid States

- Missing onboarding requirements prevent Draft generation and identify the specific missing checklist items.
- An invalid or implausibly formatted weight is not stored; the user's original message remains visible and the coach asks for a corrected value with the expected unit or format.
- An unknown food is not added or assigned invented nutrition values; the coach asks for a supported alternative.
- An incomplete Food Grid submission identifies the categories that still need a selection.
- An invalid or out-of-contract AI response is rejected by the application and never rendered as a new control or committed state.
- A plan that fails deterministic nutrition or catalog validation remains a Draft failure and cannot become Active.

### Error and Recovery States

- If message processing fails, preserve the submitted user message, show a concise in-conversation error, and offer a single retry for that same action.
- If Draft generation or modification fails, keep the previous Draft or Active Plan unchanged and state that no plan change was applied.
- If recording a weight fails after validation, leave both the history and chart unchanged and offer retry without duplicating the measurement.
- If trend or adjustment processing fails, keep the new valid measurement when it was already stored, but do not show or apply an adjustment proposal.
- If approval fails, the Active Plan remains unchanged and the proposal remains clearly marked as pending or failed rather than active.
- Recovery controls follow the same one-action-per-turn lock and cannot create duplicate messages, measurements, or approvals.

Across all error states, the interface separates failure of explanation from failure of state change: it never claims that profile data, a measurement, or a plan changed unless the deterministic application state confirms the change.
