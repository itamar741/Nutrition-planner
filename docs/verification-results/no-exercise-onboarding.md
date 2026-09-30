# No-Exercise Onboarding Verification

Date: 2026-09-30

Branch: `architecture/13-no-exercise-onboarding`

Parent: `architecture/12-capability-contracts` at `0dd345f`

## Reported failure

The exact answer `no exercise` was acknowledged, but Fresh onboarding continued
to ask the exercise question. The stored zero-volume routine had null intensity,
while checklist, turn selection, targets, and explanations all required intensity
for every exercise type. The tool also described a partial mutation as completed.

## Implemented behavior

- No exercise is stored canonically as type `none`, zero weekly sessions, zero
  session minutes, and null intensity.
- Active exercise requires positive frequency and duration plus moderate or
  vigorous intensity.
- Tool input accepts `none` as a temporary intensity sentinel and normalizes it
  before profile persistence.
- A partial open-step mutation is persisted but returns `needs_user_action` with
  the exact remaining fields.
- State schema v5 repairs existing Fresh profiles stuck at `collect-exercise`,
  recalculates the current turn and targets, and preserves messages and agent
  state.

## Verification

- Prettier formatting check;
- ESLint with zero warnings;
- TypeScript checking;
- 37 unit-test files / 273 tests;
- security scan over 189 project files;
- optimized production build;
- 24 non-screenshot Chromium scenarios; and
- 2 live-model files / 18 credentialed scenarios.

The exact browser sequence advances from `no exercise` to the eating-routine
question without `next` or `okay`. The live model calls
`submit_onboarding_facts` with a zero-volume routine and no invented intensity.
The two screenshot-writing scenarios were excluded so the four pre-existing Turn
2 PNG modifications remain outside the branch commit.
