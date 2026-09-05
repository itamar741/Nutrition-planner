# Product Backlog

## B-01 — Conversational adjustment review

Status: completed in Turn 3 on 2026-09-01.

The Existing Demo Profile's adjustment proposal must be part of the coach conversation rather than a separate dashboard card.

- The AI's validated proposal appears as an assistant chat message and includes a readable plan summary and the exact proposed food/portion changes.
- The user can approve or decline directly in that conversation turn.
- Approval activates only the exact validated proposal tied to the displayed base Active Plan version, then the coach acknowledges the new Active Plan in chat.
- Decline keeps the Active Plan unchanged and prompts the coach to ask, in chat, what the user did not like about the proposal.
- The user's follow-up feedback may guide one new bounded, catalog-backed adjustment Draft. It cannot change the evidence result, direction, kcal delta, food catalog, goal, or approval requirement.
- The interaction needs explicit loading, invalid-proposal, retry, stale-proposal, and unsupported-feedback states.

This item does not add general chat memory, arbitrary AI actions, new food lookup, goal switching, or any feature outside the approved project scope.

## B-02 — Weight display precision

Status: completed in Turn 3 on 2026-09-01.

Display every editable or read-only weight value with at most two digits after the decimal point. Keep the unrounded stored value and deterministic calculations unchanged; this is a presentation-only rule.

## B-03 — Credentialed Render staging

Status: pending external deployment credentials.

The cloud application, Blueprint, migrations, access gate, durable Arnold conversation, and bounded USDA workflow require final credentialed staging before deployment acceptance:

- create the Render Blueprint resources;
- supply the server-only OpenAI, USDA FoodData Central, and demo-access secrets;
- complete the conversation continuity, bounded-skill, visible-approval, concurrent-turn, cooked-food, controlled-failure, reset, persistence, and cross-profile checks in `docs/deployment.md`; and
- record the deployed URL, commit SHA, and evidence without recording secrets.
