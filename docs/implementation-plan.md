# Implementation Plan v0.4

Status: Turns 1–8 are implemented locally. Credentialed Render staging remains required.

This plan is governed by the project framing, description, interface design, product specification, nutrition guidance, and verification plan. The narrower documented boundary wins if two documents conflict.

## 1. Stack and Deployment

- Next.js App Router, React, and TypeScript.
- One Render Web Service for the interface and all server endpoints.
- One Render PostgreSQL database as the authoritative store.
- `pg` with plain, idempotent SQL migrations; no ORM.
- OpenAI Responses API from server-only code with `store: false`.
- USDA FoodData Central as the only verified runtime source for basic foods.
- Zod at every browser, model, source, and persisted-state boundary.
- CSS Modules, Vitest, React Testing Library, and Playwright.

Render's documented `free` Web Service and PostgreSQL plans fit the short presentation period. Free PostgreSQL expires after 30 days, has 1 GB storage, and has no backups. This is accepted for the course demo, not for production.

## 2. Runtime Architecture

```text
Browser
  temporary rendered state
  signed HttpOnly access cookie
  profileId + expectedVersion + commandId + closed action
                        |
                        v
Render Web Service (Next.js)
  access and request validation
  optimistic version check
  deterministic reducers and nutrition rules
  strict OpenAI contracts
  bounded synchronous USDA FoodData Central adapter
                        |
                        v
Render PostgreSQL
  two versioned profile aggregates
  durable conversation messages and activity events
  agent turns, skill-call audit, and conversation summaries
  central catalog and provenance
  lookup requests and candidates
  idempotent command results
  persistent rate-limit events
```

There is no background worker, browser-owned authoritative profile, general crawler, or runtime browser tool. The server performs a bounded synchronous USDA lookup with a 15-second abort deadline; the interface shows a loading state and handles timeout or source failure without state mutation.

## 3. Authoritative Data

PostgreSQL owns:

- exactly two rows: `new` and `existing`;
- a schema-validated JSONB state aggregate and optimistic integer version for each profile;
- durable user/assistant conversation messages, visible activity events, agent-turn records, skill-call audit records, and validated conversation summaries until the corresponding profile is reset;
- the baseline and runtime catalog, source identifiers, provenance, retrieval time, and approval metadata;
- lookup requests and source candidates;
- command results used for idempotency; and
- hashed-session/IP rate-limit events.

The browser never sends a replacement profile. A mutation sends the target `profileId`, `expectedVersion`, a mutation `commandId`, and one validated action. A stale version returns `409` with the current profile, reloads the interface, and asks the user to retry.

## 4. Two Shared Demo Journeys

### Fresh

- Seed: empty onboarding state, no Draft, no Active Plan.
- `Reset demo`: restores only the Fresh seed and deletes its conversation.

### Existing

- Seed: completed profile, approved foods, Active Plan, conversation context, and approximately two months of generated weight history.
- `Reset demo`: restores only the prepared Existing seed, original plan, and original weight history.

Resetting one profile never resets the other. Runtime catalog foods and rate-limit events survive both reset actions. There is no `Reset all` control.

## 5. Shared Access and Rate Limits

- One shared course-demo code; no account or authentication system.
- Constant-time comparison for equal-length codes.
- Signed `HttpOnly`, `Secure` in production, `SameSite=Lax` cookie with a 12-hour expiry.
- Required secrets remain server-side: `DATABASE_URL`, `DEMO_ACCESS_CODE`, `COOKIE_SIGNING_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `USDA_FDC_API_KEY`.
- At most 10 food-lookup workflows per hour for the same hashed session or IP.
- At most 30 food-lookup workflows per day globally.
- Only HMAC hashes are stored; raw IP addresses are never persisted.

## 6. Runtime Food State Machine

```text
QUERY
  -> EXISTING_MATCH -> ALREADY_SELECTED | ADD_TO_MY_FOODS
  -> NEEDS_CLARIFICATION -> QUERY
  -> SOURCE_SEARCHING
      -> CANDIDATE_SELECTION (maximum five)
      -> SOURCE_UNAVAILABLE -> EXPLICIT_AI_ESTIMATE_CHOICE
  -> CANDIDATE_LOADING
  -> APPROVAL_REVIEW
      -> REJECTED -> CORRECTION_QUERY
      -> APPROVED -> CENTRAL_CATALOG + REQUESTING_PROFILE
                     -> OPTIONAL_VALIDATED_DRAFT_CONTINUATION
```

When food lookup is permitted, the unified coach receives the strict `search_foods` tool alongside only the other state-dependent tools currently allowed. The food tool's arguments contain only `normalizedEnglishQuery` and `cooked | raw | packaged`. It cannot accept a URL, USDA identifier, SQL, database handle, source credential, browser instruction, or arbitrary tool. The server checks the central catalog first and owns every USDA request.

Foods that normally require cooking default to cooked. The model asks a clarification only when preparation is materially ambiguous. Hebrew and English requests are normalized to concise English; a query such as rice does not require a cooked/raw clarification.

The server:

1. checks the central catalog deterministically;
2. validates model tool arguments again;
3. calls only USDA Foundation Foods and SR Legacy search with a ten-result limit;
4. bulk-fetches those records once and prefers complete detail data;
5. accepts search-summary fallback only when calories, protein, carbohydrate, and fat are all present and plausible;
6. extracts energy by priority 2048, 2047, then 1008, plus nutrients 1003, 1005, 1004, and nullable 1079;
7. normalizes and stores complete candidates behind application UUIDs before display;
8. preserves USDA relevance order, presents the first one to five valid records, and requires explicit user selection;
9. serves selection entirely from the stored candidate without another USDA request; and
10. requires explicit approval before one transactional catalog/profile write.

Unknown fiber is stored as `null` and contributes zero to deterministic fiber totals. Runtime foods use `kosherReview: "not_checked"` and still receive a closed `neutral | meat | dairy` classification. Meat and dairy in the same meal remains invalid.

Approval is idempotent by normalized identity and source identifier. The new food becomes visible to both profiles but is selected only for the requesting profile. If the request occurred during planning, a successful approval resumes the conversation and requires the new validated Draft to contain that food. The Active Plan never changes directly.

If USDA fails or returns no valid basic food, the interface may offer `Use an AI estimate` only after explicit confirmation. Any approved fallback remains permanently labelled `AI estimate · USDA not verified`.

## 7. Arnold Conversation and Skill Orchestration

`POST /api/coach/message` is the only free-text conversation entry point. It atomically persists the user message and reserves an agent turn before model execution. It loads authoritative profile and catalog context, then supplies Arnold with a fixed system-prompt template plus chronological role/content transcript items. The transcript is never represented as a JSON string. The loop is model request → strict skill validation → bounded server execution → sanitized result → streamed Arnold continuation → persisted assistant message and validated profile transition.

The browser sends `profileId`, `expectedVersion`, `commandId`, and text or one typed visible-control action; it never sends replacement profile state. Arnold can make at most four sequential, non-parallel skill calls per turn, with availability recalculated after each result. Agent turns are idempotent, one turn may be pending per shared profile, and pending turns older than 90 seconds become recoverable. Server processing is not cancelled when a browser stream disconnects.

Interactive state, proposal cards, and visible-control actions are persisted with the profile state and durable conversation timeline. A topic change may preserve one paused workflow. The complete transcript remains persisted and rendered. When the estimated model request exceeds 60% of the configured context budget, Arnold receives a validated digest and latest 20 role/content messages; structured state always overrides the digest. Reset clears only the selected profile's transcript, activity events, summaries, preferences, workflows, agent turns, skill calls, and unapproved lookups.

Arnold may use only these bounded skills: save a clear explicit preference; inspect central-catalog, profile-approved, Draft, and Active Plan food availability; remove an approved food from future Drafts; record or edit weight; start the bounded USDA workflow; select a displayed candidate; submit a full Draft; and submit a bounded adjustment Draft. The model never receives database access, arbitrary URLs, raw USDA response bodies, browser tools, or authority to approve a food, Draft, or adjustment. Typed approval language remains non-authoritative.

Arnold creates the structured plan candidate itself using exact server-calculated targets and current approved-food data. Server code calculates all totals and validates portions, profile approval, energy, protein, AMDR, fiber, and meat/dairy rules. It returns only safe structured validation issues. Arnold may repair a rejected Draft twice; after three failed submissions it asks a focused user question and there is no hidden deterministic plan fallback. Drafts follow the selected three-meal, three-meals-plus-snack, or four-meal pattern and have no food-substitution alternatives.

Conversation limits are 30 agent turns per hour per hashed session/IP and 100 per day globally. Food-source limits remain independently enforced at 10 per hour and 30 per day. Raw IP addresses are never stored.

## 8. Bounded Endpoints

- `POST /api/demo/access`
- `GET|PATCH|POST /api/demo/state/[profileId]`
- `POST /api/coach/catalog/lookup`
- `POST /api/coach/catalog/candidate`
- `POST /api/coach/catalog/approve`
- `POST /api/coach/catalog/reject`
- `POST /api/coach/catalog/add-existing`
- `POST /api/coach/catalog/estimate`
- existing bounded onboarding, Draft, modification, and adjustment endpoints
- `GET /api/health`

All state and catalog endpoints enforce shared access in production. All untrusted bodies are strict-schema validated.

## 9. Failure Rules

- A stale mutation returns `409` and never overwrites the current state.
- A malformed model response, injected URL/SQL/tool field, unsafe source URL, parser failure, implausible nutrition record, timeout, access block, or database failure does not change a profile, catalog, Draft, or Active Plan.
- A rejected source candidate asks what should be corrected and permits a new bounded search.
- A required runtime food omitted by the plan model fails validation and triggers one repair attempt; it cannot be silently ignored.
- An approval failure keeps the candidate review visible and the confirmed state unchanged.

## 10. Verification and Deployment Sequence

1. Run formatting, lint, type checking, unit tests, production build, and serial Playwright tests.
2. Run `security:check`, dependency audit, and a separate security review; confirm the repository contains no secrets or generated test failures.
3. Create the Render Blueprint from `render.yaml`.
4. Add all required secret variables in Render.
5. Allow the migration command and health check to initialize and seed PostgreSQL.
6. Run staging lookups for cooked jasmine rice, tomato, pasta, and one controlled failure if practical.
7. Verify profile isolation, both resets, catalog persistence, persistent limits, source labels, and Draft-only continuation.
8. Record staging evidence before merge/deployment acceptance.

## 11. Intentional Tradeoffs

- Two shared profile rows are appropriate for a sequential lecturer demo, not unrelated concurrent public users.
- Optimistic conflicts avoid WebSockets but may require a retry.
- Synchronous USDA requests avoid a worker but still require a visible timeout and failure path.
- JSONB aggregates simplify reset and migrations but are not designed for analytics.
- One shared access code is privacy gating, not production authentication.
- The source adapter is low-volume and basic-food only; changed or malformed API responses fail closed.
