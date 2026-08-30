# Turn 3 Plan — Existing Profile Weight Experience

Status: Authorized on 2026-08-30.

This implementation step completes the weight-history portion of the Existing Demo Profile. The conversational adjustment review remains in [the backlog](../backlog.md) and is not included here.

## User Flow

1. The Existing profile loads a validated Active Plan and 59 seeded daily weights ending yesterday.
2. The user sees every saved point, an OLS trend line, weekly kilogram and percentage trends, and a deterministic evidence state.
3. A current weight may be submitted through a compact form or a chat message containing only a kilogram value.
4. A historical point can be selected in the graph and its weight replaced; the date is fixed by the selected point.
5. A recorded or replaced value recalculates the trend and invalidates any pending adjustment proposal.
6. Reset restores the relative-date fixture and clears local Existing-profile state.

## Constraints

- The chart shows all saved history; only the last 35 days determine the evidence gate.
- One measurement exists per calendar date. A selected historical measurement can be replaced but not deleted.
- Invalid chat text or an invalid weight is retained as a chat message and does not create a plotted point.
- An Active Plan activated within the evidence window produces insufficient evidence until a new qualifying unchanged-plan window exists.
- No date-entry flow, general chat memory, extra profile, or arbitrary AI action is added.

## Verification

- Unit-test relative fixture generation, parsing, OLS trend calculation, and the Active-Plan evidence reset.
- Test that add/replace actions update one point, preserve other measurements, clear a pending adjustment, and survive a reload.
- Verify chart keyboard access, mobile layout, reset, invalid inputs, and the sufficient/insufficient evidence states.
