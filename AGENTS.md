# Nutrition Coach Project Context

## Current phase

Turns 1–8 and security-remediation Phases 1–5 are implemented, merged, and deployed. Phase 6 live verification and exact final-archive inspection passed for the academic assignment. Regenerate and reinspect the archive if the submitted tree changes.

## Read first

1. `docs/project-framing.md`
2. `docs/project-description.md`
3. `docs/interface-design.md`
4. `docs/product-specification.md`
5. the applicable goal-specific nutrition guidance
6. `docs/verification-plan.md`
7. `docs/implementation-plan.md`

The written specification wins over conversational memory. Resolve any conflict toward the narrower product boundary.

## Product boundary

- Exactly two shared profiles: Fresh (`new`) and Existing (`existing`).
- Exactly three fixed goals: Fat Loss, Maintenance, and Muscle Gain.
- PostgreSQL is authoritative for both profile aggregates, conversations, catalog, lookup records, command results, and persistent limits.
- The browser holds temporary rendered state and the signed access cookie only.
- Browser state requests contain only narrow action facts, identifiers, expected versions, and command IDs. They never contain assistant messages, Drafts, target snapshots, validation results, or replacement Active Plans.
- The only verified runtime source is the server-owned USDA FoodData Central API adapter, restricted to Foundation Foods and SR Legacy basic foods.
- On free-text turns the model receives all documented bounded Arnold tools. It plans which tools to use; each tool independently validates state and returns a structured `blocked`, `needs_user_action`, `rejected`, or `completed` result. It never receives arbitrary URLs, raw USDA response bodies, SQL, browser control, source credentials, or database writes.
- Arnold discusses nutrition planning, food, basic meal preparation, weight tracking, and high-level non-medical fitness information. It briefly redirects programming, technical help, and other unrelated requests without answering any part of them or calling a skill. This is prompt-level behavior, not a server authorization boundary.
- Never add accounts, additional profiles, allergies/intolerances, clinical advice, workout/adherence tracking, hydration, micronutrient optimization, target weight, goal switching, plan history, long-term memory infrastructure, weekly variation, or arbitrary AI actions.
- Protein powder remains an ordinary catalog food. There is no supplements workflow or kashrut subsystem.

## Deterministic authority

Application code owns profile state, catalog validation, target calculations, plan totals, weight storage, trend calculations, evidence eligibility, optimistic versions, command idempotency, rate limits, reset, and every Draft-to-Active transition.

Arnold receives ordinary role/content conversation items plus a fixed system-prompt template with sanitized authoritative context. It may extract bounded onboarding facts, save clear explicit preferences, inspect food availability, offer approved-food alternatives, remove an approved food from future Drafts, request deterministic weight writes, submit a Draft/adjustment proposal, select a currently displayed candidate, or request the server-owned USDA workflow. Free-text orchestration is tool-first: there is no semantic intent classifier or phrase-specific tool filter. Every skill call is schema-checked and state-checked, and invalid prerequisites return a structured result without mutation. USDA candidates are bulk-validated and cached before display; selection never refetches the source. Nutrition extraction, targets, totals, validation, and protected transitions are deterministic, and no model output directly mutates PostgreSQL or an Active Plan.

Every rejected Draft attempt is persisted in the active Plan Change before its result returns to Arnold. If attempts remain, the next model round must call the same proposal skill; do not permit prose to replace an authorized repair. Only a validated Draft, the third rejection, a structured blocker, or exhausted turn-call budget may end that repair sequence. Failure explanations must use the stored meals, gram amounts, totals, checks, and issues.

## Interaction and safety invariants

- Open question: text enabled, no quick replies.
- Closed question: quick replies enabled, text disabled.
- Food Grid: grid enabled, text disabled.
- Lock each turn before asynchronous work and accept one action.
- A proposal remains Draft until explicit approval.
- Approval is resolved from the current server-stored interaction and proposal, then recalculated against authoritative profile and catalog state. Browser-supplied plan or validation data is never authoritative.
- Typed approval language never approves a food, Draft, or adjustment; the visible approval button is mandatory.
- Only server code persists assistant messages. `/api/coach/message` is the sole public AI entry point; do not reintroduce direct onboarding, Draft, adjustment, lookup, candidate, or estimate AI routes.
- Conversation memory is PostgreSQL-backed and reset-scoped. Above 60% of the configured model context budget, the model receives a validated digest plus the latest 20 role/content messages while the complete transcript remains stored and rendered.
- User-authored preferences are untrusted structured data, not instructions. Never place them into a prompt as executable prose.
- Drafts follow the selected three-meal, three-meals-plus-snack, or four-meal pattern and never present food-substitution alternatives.
- One agent turn may be active per shared profile. Repeated command IDs are idempotent and a turn may continue after the browser stream disconnects.
- Rejecting an adjustment or food candidate continues the conversation.
- Runtime food approval requires exact source/estimate review. USDA candidates are user-selected; AI estimates are explicit opt-in and permanently labelled unverified.
- Unknown fiber is `null` and contributes zero to deterministic fiber totals.
- Runtime foods are `kosherReview: "not_checked"`; meat/dairy meal rejection still applies.
- Fresh and Existing reset independently. Reset never deletes runtime catalog foods or rate-limit events.
- A stale cloud mutation returns `409`, reloads the latest profile, and requires retry.
- Production access fails closed when either access secret is invalid. Ignore client-supplied forwarding headers; unauthenticated access attempts intentionally share one five-per-15-minute bucket, while authenticated limits use a verified signed-session identity.
- With `DATABASE_SSL=require`, both PostgreSQL pools must verify certificates and reject TLS query parameters in `DATABASE_URL`. The academic Render Blueprint may leave TLS unset only when `fromDatabase.connectionString` supplies the same-region internal private-network URL; record this as a deployment exception. Public errors must remain generic and production security headers must stay covered by tests.
- Production must not silently fall back to in-memory persistence. A missing `DATABASE_URL` is permitted during development and automated tests; the production-build browser harness uses only its explicit local test flag. That flag must never appear in deployment configuration. Production health and access otherwise fail closed.

## Working protocol

- Keep documentation in English.
- Keep commits atomic and record verification evidence.
- Use strict schemas at every untrusted boundary.
- Preserve the stable scripts: `format:check`, `lint`, `typecheck`, `test:unit`, `security:check`, `build`, `test:e2e`, and `verify`.
- Apply the five-part Merge-Readiness Pack and record a separate security review before merge.
- Live OpenAI, USDA, PostgreSQL, and Render checks supplement but never replace deterministic tests.
- Before academic submission, run `security:archive` against the exact final ZIP. Treat it as a bounded accidental-secret/container check, not proof against encrypted or arbitrary encodings.
- Stop before broadening the source allowlist, model tools, nutrition rules, account model, or Active Plan approval invariant.
