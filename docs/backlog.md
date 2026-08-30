# Product Backlog

## B-01 — Conversational adjustment review

Status: queued. Added from user feedback on 2026-08-30; not implemented yet.

The Existing Demo Profile's adjustment proposal must be part of the coach conversation rather than a separate dashboard card.

- The AI's validated proposal appears as an assistant chat message and includes a readable plan summary and the exact proposed food/portion changes.
- The user can approve or decline directly in that conversation turn.
- Approval activates only the exact validated proposal tied to the displayed base Active Plan version, then the coach acknowledges the new Active Plan in chat.
- Decline keeps the Active Plan unchanged and prompts the coach to ask, in chat, what the user did not like about the proposal.
- The user's follow-up feedback may guide one new bounded, catalog-backed adjustment Draft. It cannot change the evidence result, direction, kcal delta, food catalog, goal, or approval requirement.
- The interaction needs explicit loading, invalid-proposal, retry, stale-proposal, and unsupported-feedback states.

This item does not add general chat memory, arbitrary AI actions, new food lookup, goal switching, or any feature outside the approved project scope.

## B-02 — Weight display precision

Status: queued. Added from user feedback on 2026-08-30; not implemented yet.

Display every editable or read-only weight value with at most two digits after the decimal point. Keep the unrounded stored value and deterministic calculations unchanged; this is a presentation-only rule.
