# Draft Repair Continuity Verification

Date: 2026-09-30

Branch: `architecture/11-draft-repair-continuity`

Parent: `architecture/10-tool-first-verification` at `1a82d8f`

## Reported failure

After cottage cheese was approved and a complete replacement Draft failed its
nutrition checks, Arnold stopped with an offer to try again. A later details
question produced only a generic high-calorie/high-protein explanation and exposed
an encoded space as `&#x20;`.

The root causes were distinct:

- a rejected result left later model rounds on automatic tool choice, so prose
  could end the turn while attempts remained;
- attempts one and two lived only in a local array and did not mutate persisted
  state; and
- model prose was stored and rendered verbatim without character-entity
  normalization.

## Implemented behavior

- Schema v4 adds `rejectedDraftAttempts` to the durable Plan Change.
- Every rejected ordinary Draft is stored under the active turn lease before its
  tool result returns.
- A remaining authorized repair makes `submit_draft_proposal` mandatory on the next
  model round. Missing that required call fails closed instead of showing “try
  again?” as a successful turn.
- Attempt numbering resumes from persisted state after a provider failure.
- The third rejection creates the existing `draft_failure_review` from the same
  persisted attempt records.
- Selecting a retry strategy increments the attempt batch and clears the previous
  batch's attempt list.
- Later explanation turns receive exact meals, grams, totals, checks, and issues in
  authoritative context.
- Safe numeric and common named entities are decoded before assistant prose is
  streamed and persisted; unsafe or unsupported entities remain literal text.

## Verification

All required gates pass on the branch:

- Prettier formatting check;
- ESLint with zero warnings;
- TypeScript checking;
- 35 unit-test files / 260 tests;
- security scan over 183 project files;
- optimized production build;
- 23 Chromium browser scenarios;
- 2 live-model files / 11 credentialed tests; and
- `git diff --check`.

The live matrix forced three consecutive Draft submissions, observed no
permission-seeking prose between rejections, and confirmed that Arnold changed
the candidate meals between repair attempts.

The four pre-existing Turn 2 PNG modifications remain outside this branch's commit.
