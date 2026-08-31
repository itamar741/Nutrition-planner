# Turn 2 Draft Generation Fix

- Date: 2026-08-30
- Branch: `turn-2-catalog-and-plan`
- Fix commits: `c20b82c`, `f0588a6`, `54e53d5`, `7680f5d`, and `f9fbd7d`

## Observed Failure

With a valid completed profile and six approved catalog foods, Draft generation returned the generic validation failure after two model attempts. Server-side diagnosis showed that the model treated each approved food as if it could appear only once. That under-filled the daily energy, protein, and fiber targets. The same response also added alternatives that were not independently valid.

After a declined Draft, the interface also had no way to collect free-text feedback. Once that path was added, the reported preference to eat more in the evening still produced under-filled model candidates. The first deterministic repair could raise energy and fiber but could also exceed the protein maximum, such as 142 g against a 136 g limit, leaving the candidate invalid.

## Resolution

The Draft contract instructions now state that approved foods may be reused across multiple meals, require whole-day totals to be checked before returning, and make `alternatives: []` the safe default unless a complete-day substitution has been verified. After a declined Draft, the user can now describe requested changes in a text field and generate a revised Draft without changing the Active Plan.

For feedback-based revisions, the model gets one feedback-aware attempt followed by one bounded attempt focused on returning a standard valid plan. If either attempt returns a structurally valid candidate, deterministic recovery may repair its portions, remove unverified alternatives, add approved food repetitions, reduce excess protein, and rebalance energy, fiber, and macronutrient ranges. If that candidate cannot be recovered, a fresh deterministic candidate is constructed from the approved catalog foods and meal pattern. Later meals are prioritized when the feedback requests more evening food.

Recovery never runs on malformed model output. The catalog allow-list, meal-count rules, portion limits, nutrition tolerances, meat-and-dairy separation, and explicit approval boundary remain authoritative.

## Verification

- The exact reported profile and six-food selection are covered by a regression test for the deterministic recovery path.
- The Draft remains a Draft until explicit approval; declining or revising it does not change the Active Plan.
- Malformed model output is still rejected after two attempts and cannot enter deterministic recovery.
- `npm run verify`: passed — Prettier, ESLint, TypeScript, 7 Vitest files / 41 tests, Next build, and 9 Playwright scenarios.
- The contract suite asserts that reusable-food and no-unverified-alternatives instructions remain present.
- Human verification on 2026-08-30: the user retried the previously failing live feedback flow and confirmed, “אוקיי עבר” (it passed).

This human check verifies the reported Draft-generation bug fix. It is not the separate final acceptance of Turn 2 or authorization to merge it.

The request for a larger catalog is intentionally deferred to a short, source-reviewed research step. No new foods were added in this fix.
