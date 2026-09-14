# Agentic Flow Architecture Roadmap and Recovery Anchor

Last updated: 2026-09-14

This is the durable source of truth for the multi-phase Arnold agentic-flow
work. Read this file before continuing after a context summary, interruption, or
new session. Update the checkpoint section before leaving a phase.

## Objective

Make Arnold's conversation flow coherent and state-driven rather than a series
of phrase-specific patches. Open-ended language may be interpreted by a model,
but every mutation must be authorized and validated by deterministic server
contracts tied to persisted state.

The user-visible outcome is:

- Arnold understands ordinary nutrition requests, contextual replies, spelling
  mistakes, questions, hypotheticals, and negations.
- Arnold never claims that a state change happened unless a bounded server action
  succeeded.
- A meal-plan proposal is always a formal Draft. Text cannot silently replace an
  Active Plan or stand in for a failed Draft.
- The Active Plan changes only through the current visible approval control.
- A failed flow can be resumed intentionally without reviving an unrelated or
  stale intent.

## Confirmed Product Decisions

These decisions are authoritative unless the user explicitly changes them:

1. **Arnold calculates food quantities.** There will be no deterministic portion
   optimizer or hidden fallback plan generator. Arnold understands human-scale
   portions and performs the candidate-plan mathematics.
2. **The server is the judge.** It independently calculates totals and validates
   approved-food membership, practical portion limits and steps, energy, protein,
   AMDR, fiber, meal pattern, and meat/dairy separation.
3. **One requested food replacement permits whole-Draft rebalancing.** Arnold must
   include the selected approved replacement and exclude the unwanted food, but
   may recalculate quantities in every meal and may change other approved foods as
   needed. It must not assume a one-for-one gram substitution.
4. **Three model attempts remain observable.** Arnold may repair a rejected Draft
   twice. After the third rejection it shows the complete attempt record and asks
   one focused question. A user's retry choice opens a new three-attempt batch and
   must call the Draft tool before any replacement-plan prose.
5. **Different mix has real semantics.** `different_approved_mix` requires a
   change in the actual set of approved food IDs; gram-only edits do not satisfy
   it.
6. **Open language, closed actions.** A structured model decision interprets the
   current message. Deterministic policy intersects it with authoritative state
   and exposes the minimum permitted skill set. Questions, hypotheticals,
   negations, unsupported requests, and unknown decisions cannot expose mutating
   skills.
7. **Approvals are protected.** Text such as "approve it" never approves a food,
   Draft, or adjustment. Only the current visible typed interaction can do so.
8. **Deterministic controls do not spend AI quota.** Controls that need no model
   execute directly. Trend review, adjustment generation, and confirmed
   AI-backed Draft generation remain model-backed.
9. **No merge or deployment during this roadmap.** Commits and pushes are
   authorized. Each phase must be implemented on a child branch of the previous
   phase so ancestry preserves the review order.

## Branch Chain

The chain starts from local commit `5f7bd57` on
`docs/final-submission-evidence`. That local branch itself contains three commits
not yet present on `origin/docs/final-submission-evidence`.

| Phase | Branch                                     | Parent                                        | Status               |
| ----- | ------------------------------------------ | --------------------------------------------- | -------------------- |
| 1     | `architecture/01-structured-turn-contract` | `docs/final-submission-evidence` at `5f7bd57` | Complete (`859c8c1`) |
| 2     | `architecture/02-turn-fencing`             | Phase 1                                       | Complete (`cc75510`) |
| 3     | `architecture/03-workflow-state`           | Phase 2                                       | Complete (`7f6fbf6`) |
| 4     | `architecture/04-onboarding-routing`       | Phase 3                                       | Ready to commit      |
| 5     | `architecture/05-contract-hardening`       | Phase 4                                       | Pending              |
| 6     | `architecture/06-final-verification`       | Phase 5                                       | Pending              |

Create each branch only after its parent phase is committed and verified. Push
each branch with its explicit upstream. Do not rebase or squash the chain during
implementation.

## Phase 1 — Structured Turn Contract

Purpose: replace mutation authorization based on scattered phrase checks with a
typed interpretation and deterministic execution policy.

Included work:

- Strict structured turn decision with intent, speech act, food names, plan
  strategy, and an exact evidence excerpt from the current message.
- Deterministic mapping from the decision to the minimum permitted skills.
- Persisted `PlanChangeWorkflow` with baseline, required and excluded foods,
  offered alternatives, selected alternative, requested scope, whole-Draft
  portion recalculation, strategy, and attempt batch.
- Approved alternative offers stored by catalog ID. A reply is valid only if it
  matches one of those stored IDs.
- Whole-plan requests and selected replacements force a formal Draft attempt.
- Retry after three failures opens a new Draft-attempt batch; it cannot fall back
  to a prose-only meal plan.
- Candidate semantics reject omitted required foods, restored excluded foods,
  unchanged plans, uncompensated food appends, and fake "different mix" changes.
- Centralized interaction state with one paused workflow restored after the
  active workflow completes.
- Deterministic visible controls bypass the model and the AI rate limit.
- The agent loop stops when a new user-decision interaction is created.

Required regression examples:

- `i dont like rice. any other oprions for my meal plan?`
- A stored approved alternative selection.
- `different mix of approved foods` after three rejected submissions.
- `I want to change the whole meal plan`.
- `Do not change my meal plan`.
- Hypothetical and negated weight mutations.

Checkpoint before Phase 2:

- Formatting, lint, typecheck, unit tests, security scan, and production build
  passed.
- Latest result before this file was written: 38 unit files and 252 tests passed;
  180 project files passed the security scan.
- Browser suite previously passed 23 tests and live decision suite passed 4
  tests. Re-run them on the final phase and after any relevant behavior change.

## Phase 2 — Durable Turn Lease and Stale-Write Fencing

Purpose: ensure an old or timed-out model turn can never write after a newer turn
has taken ownership of the profile.

Research and implementation requirements:

- Map reservation, timeout recovery, partial assistant-message persistence,
  profile mutation, tool-call recording, and turn completion as one state machine.
- Add a unique lease/fencing token to each reservation. Every profile mutation,
  tool-result write, partial/final assistant write, and completion must prove it
  still owns the active lease.
- Recover an expired lease without allowing the expired worker to commit later.
- Preserve command idempotency: same command and same payload replays safely;
  mismatched reuse fails.
- Make browser disconnect behavior explicit: server work may continue only while
  the lease is valid.
- Add concurrency tests for old-worker completion, stale partial text, duplicate
  commands, expired leases, and simultaneous profile turns.

Implemented checkpoint:

- Every reservation attempt owns a new random lease token. Recovery rotates the
  token, so an expired worker cannot write with its previous ownership proof.
- Profile mutations, assistant output, activity events, conversation summaries,
  tool-call records, lookup state, and candidate writes made by the coach verify
  the current lease. Ordinary profile mutations atomically expire a stale turn
  before writing and reject while a live turn exists.
- The route renews a valid lease every 30 seconds, and successful persisted work
  also refreshes it. The recovery threshold remains 90 seconds.
- Expiring a turn also marks its current pending or partial assistant message as
  failed. Completion is terminal: the former owner cannot append output after it.
- Added memory-persistence race tests for lease rotation, late assistant,
  activity, skill, lookup, candidate, and profile writes, terminal writes,
  heartbeat renewal, and ordinary writes after expiry.
- Verification result: 38 unit files and 255 tests passed; formatting, lint,
  typecheck, security scan (181 files), and production build passed.

Non-goal: changing the user-visible one-minute AI limit.

## Phase 3 — Unified Workflow and Continuation State

Purpose: make contextual replies depend on an explicit persisted workflow rather
than accidental recent-text interpretation.

Research and implementation requirements:

- Inventory every `AgentInteraction`, `planChange`, pending operation, paused
  interaction, Draft, adjustment, candidate, and conversation-summary transition.
- Define which states may coexist and encode those invariants in one transition
  module.
- Define deterministic completion, cancellation, pause, resume, and topic-switch
  behavior for each workflow.
- Ensure short answers such as a food name, "yes", "different mix", or "delete
  it" resolve only against a compatible current interaction.
- Prevent a recent transcript message from reviving a completed, cancelled, or
  unrelated mutation.
- Make a new explicit request supersede or pause old state according to one
  documented rule.
- Add transition-matrix and multi-turn tests, including refresh/reload between
  every pair of turns.

## Phase 4 — Structured Onboarding Routing

Purpose: remove the remaining architectural split in which ready profiles use the
turn decision while incomplete Fresh profiles bypass it.

Research and implementation requirements:

- Route onboarding answers through the same top-level turn decision without
  replacing the existing bounded fact extractor.
- Distinguish onboarding answers from unrelated questions, unsupported requests,
  negations, and explicit corrections.
- Expose only onboarding extraction while an onboarding answer is authorized.
- Preserve one-question-at-a-time onboarding and deterministic target
  calculation.
- Test topic switches, corrections, ambiguous answers, repeated facts, and
  attempts to invoke plan or catalog mutations before readiness.

Implemented Phase 3 checkpoint:

- Contextual answers now receive mutation authority only when the current
  persisted interaction belongs to the compatible workflow. Recent transcript
  text remains conversational context but cannot revive an old weight, food, or
  Draft mutation.
- A single transition module now handles same-workflow continuation, the first
  paused workflow, explicit resume, completion, and supersession after another
  topic switch.
- Turn-start reconciliation removes Plan Change state with a stale Active Plan
  or Draft baseline and prunes stale Draft-approval, Draft-failure, and
  adjustment interactions before policy authorization.
- Exact stored alternative selections additionally require the active Draft
  clarification; an unrelated current interaction cannot consume the old offer.
- Verification result: 38 unit files and 262 tests passed; formatting, lint,
  typecheck, security scan (181 files), and production build passed.

Implemented Phase 4 checkpoint:

- Incomplete Fresh text now passes through the same structured decision as a
  ready profile. The persisted onboarding turn is supplied as authoritative
  context so a short value is an answer only when its meaning is unambiguous.
- Only an onboarding answer with exact current-message evidence can reach the
  existing bounded fact extractor. All ordinary tools are unavailable until
  onboarding is complete, including for premature plan and catalog requests.
- Questions, hypotheticals, negations, unsupported requests, and unknown turns
  remain conversational and preserve the profile and onboarding question.
- Explicitly stated corrections may replace bounded onboarding facts while the
  profile is incomplete. Correcting current weight also upserts the same-day
  onboarding measurement so profile and trend state cannot diverge.
- Verification result: 38 unit files and 273 tests passed; formatting, lint,
  typecheck, security scan (181 files), and production build passed.

## Phase 5 — Contract Hardening and Architectural Edge Cases

Purpose: cover failures that remain possible even with correct intent routing.

Required investigations:

- **Trend consistency:** ensure current measurements always produce the same
  deterministic trend facts, evidence label, adjustment gate, UI, and Arnold
  explanation. Clarify which Active Plan target/reference values are snapshots and
  which views are dynamic.
- **Catalog identity:** inspect duplicate foods, aliases, display-name matching,
  approved-food membership, removal while used by Active Plan, and selections
  that are not among stored offered IDs.
- **Portion contracts:** verify min/max/step behavior, duplicate food IDs across
  meals, floating-point rounding, boundary totals, and model repair guidance.
- **Draft lifecycle:** stale base versions, concurrent approval/rejection,
  revising an existing pending Draft, approval after reset, and Active Plan
  immutability before approval.
- **Topic and security boundaries:** prompt injection in food names and saved
  preferences, mixed in-scope/out-of-scope requests, tool arguments not supported
  by evidence, and claims of success without tool results.
- **Rate-limit recovery:** countdown source of truth, reload behavior, deterministic
  buttons while limited, and expiry at the exact boundary.
- **Failure UX:** source outages, classifier contract failure, empty alternative
  sets, no valid Draft after multiple batches, and safe actionable messages that
  do not expose internals.

Implement fixes as reusable contracts or transitions. Do not add phrase-specific
regular expressions to the main orchestrator when the condition can be represented
as typed state or policy.

## Phase 6 — Final Verification and Handoff

Required checks:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:unit`
5. `npm run security:check`
6. `npm run build`
7. `npm run test:e2e`
8. `npm run test:ai-live`
9. `git diff --check`

Also run a manual conversation matrix against Fresh and Existing for all six
capability cards and the regression messages above. Record the exact deployed or
local revision used for evidence. Final output should identify any residual
model-dependent limitation honestly.

## Invariants That Must Never Regress

- Client requests contain commands, never replacement profile state.
- State is loaded authoritatively on every turn.
- Only approved catalog IDs may enter a Draft.
- A Draft never modifies the Active Plan before visible approval.
- Text never crosses a protected approval boundary.
- The model has no database, arbitrary URL, browser, or unrestricted tool access.
- Tool schemas, server authorization, and deterministic validation remain the
  security boundary even when model classification is wrong.
- A model question or hypothetical cannot mutate state.
- A plan shown as a proposal must correspond to the persisted Draft card.
- Model-generated quantities are accepted only after server-calculated validation.
- No hidden deterministic meal-plan generator is introduced.

## User-Owned and Out-of-Scope Working-Tree Files

The following image files were already modified and/or were regenerated by prior
browser verification. They are not part of the architecture commits and must not
be staged, overwritten intentionally, reverted, or deleted:

- `docs/verification-results/turn-2-active.png`
- `docs/verification-results/turn-2-draft.png`
- `docs/verification-results/turn-2-food-grid-mobile.png`
- `docs/verification-results/turn-2-food-grid.png`

Before every commit, inspect `git status --short` and stage explicit paths only.

## Context-Recovery Procedure

After any summary or interruption:

1. Read this complete file.
2. Run `git branch --show-current`, `git log --oneline --decorate -8`, and
   `git status --short`.
3. Confirm that the current branch is the expected child in the branch-chain
   table.
4. Inspect the latest phase commit and test output before repeating work.
5. Continue the first incomplete phase; do not restart completed phases.
6. Update `Last updated`, branch status, checkpoint notes, test counts, and any
   newly discovered architectural constraint in this file.
7. Never include the user-owned verification PNGs in a phase commit.

## Current Checkpoint

- Current branch: `architecture/04-onboarding-routing`.
- Current phase: Phase 4, verified and ready for explicit-path commit and push.
- Next action: commit and push Phase 4, then create
  `architecture/05-contract-hardening` from it and audit the remaining trend,
  catalog, portion, Draft, security, rate-limit, and failure contracts.
- Merge/deploy status: not authorized; do neither.
