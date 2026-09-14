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

Status: completed for the academic assignment on 2026-09-14. The accepted live deployment and access checks are recorded in [Phase 6](verification-results/phase-6.md). Earlier turn-specific staging lists remain historical evidence and are not silently reclassified as checks that were run.

The cloud application, Blueprint, migrations, access gate, durable Arnold conversation, and bounded USDA workflow require final credentialed staging before deployment acceptance:

- create the Render Blueprint resources;
- supply the server-only OpenAI, USDA FoodData Central, and demo-access secrets;
- complete the conversation continuity, named-food first-search, bounded-skill, visible-approval, concurrent-turn, controlled-failure, reset, persistence, and cross-profile checks in `docs/deployment.md`; and
- record the deployed URL, commit SHA, and evidence without recording secrets.

## B-04 — Visible nutrition decision journey

Status: implemented and deterministically verified. The academic deployment gate was accepted on 2026-09-14 in [Phase 6](verification-results/phase-6.md).

The product must make its deterministic nutrition work visible without overwhelming a beginner. Once targets exist, both demo journeys show a progressively disclosed explanation from profile inputs through the current nutrition decision.

- Show the personal activity mapping, raw EER estimate, goal adjustment, controlled rounding, daily macro targets, and research sources.
- When a Draft or Active Plan exists, show its actual values against the same deterministic energy, protein, AMDR, fiber, catalog, portion, meal-pattern, and composition checks that gate activation.
- For a profile with weight history, show the evidence count and span, calculated weekly rate, goal band, Maintenance drift evidence when applicable, and the exact reason a plan stays unchanged or a bounded adjustment becomes available.
- Generate explanations from shared domain rules rather than duplicating formulas or thresholds in the interface.
- Keep the presentation reusable for any valid supported profile. Presentation components must not depend on a demo profile identifier or fixture.

This item adds contextual education and transparency only. It does not add analytics, a general knowledge library, accounts, additional profile types, clinical guidance, or another AI call.
