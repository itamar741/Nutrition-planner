# Capability Contracts Verification

Date: 2026-09-30

Branch: `architecture/12-capability-contracts`

Parent: `architecture/11-draft-repair-continuity` at `19d400e`

## Implemented behavior

- The six user-visible capability cards and their examples now come from one
  shared contract also supplied to Arnold.
- `Try it` fills the current composer and smoothly reveals it without focus or
  automatic submission in Existing, Fresh Active, and pre-activation Fresh
  views.
- Arnold receives the same authoritative EER/TDEE, PAL, goal adjustment, macro,
  fiber, and plan-validation explanation used by the transparency UI.
- Calculation and weight-trend review questions are explicitly read-only and do
  not cross a skill or approval boundary.
- The empty Fresh `Generate Draft` control sends a typed `generate_draft` event.
  The server accepts it only for a completed Fresh profile with saved foods and
  targets, no competing Draft, Active Plan, or Plan Change, and then forces
  `submit_draft_proposal` as the first skill.
- Custom composer text remains an ordinary free-text request and is not routed by
  phrase matching.

## Verification

- Prettier completed with no changes required after formatting.
- ESLint passed with zero warnings.
- TypeScript checking passed.
- 36 unit-test files / 265 tests passed.
- The security scan passed over 186 project files.
- The optimized production build passed.
- 23 non-screenshot Chromium scenarios passed together. The two
  screenshot-writing scenarios were deliberately excluded to preserve the four
  user-owned verification PNGs.
- 2 live-model files / 17 credentialed scenarios passed together.
- `git diff --check` passed.

The live coverage includes the exact advertised Draft, food search, TDEE,
weight-recording, trend-review, and goal-change prompts, as well as whole-plan
replacement, stored alternatives, Draft continuation, protected approvals,
hypotheticals, and topic boundaries.

The four pre-existing Turn 2 PNG modifications remain outside this branch's
commit.
