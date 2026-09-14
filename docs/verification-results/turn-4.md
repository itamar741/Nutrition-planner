# Turn 4 Verification Results

Date: 2026-09-02

Branch: `turn-4-render-runtime-catalog`

Historical status: local automated gates passed. Credentialed PostgreSQL/Render/ScrapingBee staging was pending at this point. The ScrapingBee design was later replaced by USDA, and the current academic deployment status is consolidated in [Phase 6](phase-6.md).

## Implemented controls

- PostgreSQL schema and baseline seeds for the two versioned profile aggregates, central catalog, lookup requests, candidates, idempotent commands, and rate-limit events.
- Independent Fresh and Existing reset semantics that preserve runtime catalog foods and rate-limit events.
- Optimistic version conflicts with current-state recovery.
- Shared-code access cookie signing and constant-time code comparison.
- HMAC-only IP/session identities with hourly and daily lookup limits.
- One strict OpenAI `search_food_source` function tool and server validation of every argument.
- Host/path allowlisting, five-result limit, bounded ScrapingBee timeout, explicit per-100-g table parsing, separate practical servings, parser plausibility checks, nullable fiber, source labels, and explicit candidate selection.
- Transactional approval into the central catalog and requesting profile only.
- Explicit AI-estimate fallback after source failure.
- Automatic Draft-only planning continuation that requires the approved runtime food.
- Conversational rejection/correction states and visible source-review cards.

## Automated results

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed.
- `npm run test:unit` — passed: 12 files, 67 tests.
- `npm run build` — passed; all application and API routes compiled.
- `npm run test:e2e` — passed: 13 Chromium scenarios in serial cloud-demo mode.

The unit suite covers profile isolation, stale versions, command idempotency, reset preservation, transactional approval, persistent rate limits, access tokens, hashed identities, strict tool arguments, Fuder search/detail parsing, nullable fiber, nutrition plausibility, and required-food Draft continuation.

The browser suite covers the two original demos, conversational adjustment review, two-decimal weight behavior, candidate selection, source review, rejection and correction, approval, and the explicit AI-estimate offer.

## External Controls Pending at the Time

The following cannot be claimed without the project owner's service credentials:

- migration and seed against a real Render PostgreSQL instance;
- signed-access behavior at the deployed HTTPS URL;
- two or three low-volume live ScrapingBee/Fuder lookups;
- cooked-food and packaged-product source verification;
- deployed stale-state and cross-profile checks; and
- final Render staging screenshots and human acceptance.

Follow `docs/deployment.md` and append the deployed URL, commit SHA, source examples, and results here after staging. Never append secret values.
