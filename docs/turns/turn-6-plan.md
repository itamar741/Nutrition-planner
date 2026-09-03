# Turn 6 — USDA Candidate Reliability

## Goal

Remove the failure window between USDA candidate display and candidate selection. A candidate shown to the user must already contain validated nutrition data and selection must not call USDA again.

## Implementation

- Search the first ten Foundation Foods and SR Legacy results.
- Fetch their detail records with one bounded USDA `/foods` request.
- Prefer complete detail data and use complete, plausible search-summary nutrition only when detail is unavailable.
- Require calories, protein, carbohydrate, and fat; preserve missing fiber as `null`.
- Resolve energy by nutrient priority 2048, 2047, then 1008 and retain the chosen ID in provenance.
- Cache the first five safe candidates in source order before rendering their macro cards.
- Build the selected approval record from cached data, with no second source request.
- Emit stage-specific safe diagnostics without raw source data or credentials.

## Acceptance

Green bell pepper Foundation records using nutrient 2048 succeed. A stale detail record with complete search nutrition is labelled `USDA search data`. Incomplete records are hidden. One to five safe results are valid, and selecting any displayed result makes no USDA request.
