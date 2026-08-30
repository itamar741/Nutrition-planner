# Turn 2 Draft Generation Fix

- Date: 2026-08-30
- Branch: `turn-2-catalog-and-plan`
- Fix commit: recorded in Git with the implementation change below

## Observed Failure

With a valid completed profile and six approved catalog foods, Draft generation returned the generic validation failure after two model attempts. Server-side diagnosis showed that the model treated each approved food as if it could appear only once. That under-filled the daily energy, protein, and fiber targets. The same response also added alternatives that were not independently valid.

## Resolution

The Draft contract instructions now state that approved foods may be reused across multiple meals, require whole-day totals to be checked before returning, and make `alternatives: []` the safe default unless a complete-day substitution has been verified. The deterministic catalog and nutrition validator remains authoritative.

## Verification

- Live local retry with the reported profile now returns a validated Draft: 3,374 kcal, 127 g protein, and 45.5 g fiber against a 3,225 kcal target.
- The Draft remains a Draft until explicit approval; no Active Plan was written during the diagnostic retry.
- `npm run verify`: passed — Prettier, ESLint, TypeScript, 7 Vitest files / 38 tests, Next build, and 9 Playwright scenarios.
- The contract suite now asserts that the reusable-food and no-unverified-alternatives instructions remain present.

The request for a larger catalog is intentionally deferred to a short, source-reviewed research step. No new foods were added in this fix.
