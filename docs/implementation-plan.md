# Implementation Plan v0.3

Status: Turns 1–3 are implemented. Turn 4 is implemented and verified locally on `turn-4-render-runtime-catalog`; credentialed Render staging remains required before deployment acceptance.

This plan is governed by the project framing, description, interface design, product specification, nutrition guidance, and verification plan. The narrower documented boundary wins if two documents conflict.

## 1. Stack and Deployment

- Next.js App Router, React, and TypeScript.
- One Render Web Service for the interface and all server endpoints.
- One Render PostgreSQL database as the authoritative store.
- `pg` with plain, idempotent SQL migrations; no ORM.
- OpenAI Responses API from server-only code with `store: false`.
- ScrapingBee as the only source adapter for low-volume Fuder requests.
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
  bounded synchronous ScrapingBee/Fuder adapter
                        |
                        v
Render PostgreSQL
  two versioned profile aggregates
  chat messages inside each aggregate
  central catalog and provenance
  lookup requests and candidates
  idempotent command results
  persistent rate-limit events
```

There is no background worker, browser-owned authoritative profile, general crawler, or runtime browser tool. The server performs a bounded synchronous lookup with a 35-second abort deadline; the interface shows a loading state and handles timeout or source failure without state mutation.

## 3. Authoritative Data

PostgreSQL owns:

- exactly two rows: `new` and `existing`;
- a schema-validated JSONB state aggregate and optimistic integer version for each profile;
- persisted chat messages until the corresponding profile is reset;
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
- Required secrets remain server-side: `DATABASE_URL`, `DEMO_ACCESS_CODE`, `COOKIE_SIGNING_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `SCRAPINGBEE_API_KEY`.
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

The model receives exactly one function tool: `search_food_source`. Its strict arguments contain only normalized query, `cooked | raw | packaged`, optional brand, and optional serving hint. The model receives no URL, SQL, database handle, ScrapingBee setting, browser instruction, or arbitrary tool.

Foods that normally require cooking default to cooked. The model asks a clarification only when preparation, brand, package size, or customary unit is materially ambiguous. A query such as rice does not require a cooked/raw clarification.

The server:

1. checks the central catalog deterministically;
2. validates model tool arguments again;
3. constructs the allowlisted Fuder URL itself;
4. uses JavaScript rendering only for search when needed;
5. accepts only Fuder `/foods/` links and at most five source-order candidates;
6. fetches details only for the user's selected candidate;
7. extracts allowlisted nutrition fields and never exposes raw HTML;
8. normalizes values to per 100 g plus a practical display serving; and
9. requires explicit approval before one transactional catalog/profile write.

Unknown fiber is stored as `null` and contributes zero to deterministic fiber totals. Runtime foods use `kosherReview: "not_checked"` and still receive a closed `neutral | meat | dairy` classification. Meat and dairy in the same meal remains invalid.

Approval is idempotent by normalized identity and source identifier. The new food becomes visible to both profiles but is selected only for the requesting profile. If the request occurred during planning, a successful approval resumes the conversation and requires the new validated Draft to contain that food. The Active Plan never changes directly.

If Fuder or ScrapingBee fails, the interface may offer `Use an AI estimate` only after explicit confirmation. Any approved fallback remains permanently labelled `AI estimate · Fuder not verified`.

## 7. Bounded Endpoints

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

## 8. Failure Rules

- A stale mutation returns `409` and never overwrites the current state.
- A malformed model response, injected URL/SQL/tool field, unsafe source URL, parser failure, implausible nutrition record, timeout, access block, or database failure does not change a profile, catalog, Draft, or Active Plan.
- A rejected source candidate asks what should be corrected and permits a new bounded search.
- A required runtime food omitted by the plan model fails validation and triggers one repair attempt; it cannot be silently ignored.
- An approval failure keeps the candidate review visible and the confirmed state unchanged.

## 9. Verification and Deployment Sequence

1. Run formatting, lint, type checking, unit tests, production build, and serial Playwright tests.
2. Confirm the repository contains no secrets or generated test failures.
3. Create the Render Blueprint from `render.yaml`.
4. Add all required secret variables in Render.
5. Allow the migration command and health check to initialize and seed PostgreSQL.
6. Run two or three staging lookups: one cooked food, one packaged product, and one controlled failure if practical.
7. Verify profile isolation, both resets, catalog persistence, persistent limits, source labels, and Draft-only continuation.
8. Record staging evidence before merge/deployment acceptance.

## 10. Intentional Tradeoffs

- Two shared profile rows are appropriate for a sequential lecturer demo, not unrelated concurrent public users.
- Optimistic conflicts avoid WebSockets but may require a retry.
- Synchronous ScrapingBee avoids a paid worker but can take several seconds.
- JSONB aggregates simplify reset and migrations but are not designed for analytics.
- One shared access code is privacy gating, not production authentication.
- The source adapter is experimental and low-volume; changed markup must fail closed.
