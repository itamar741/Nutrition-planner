# Security Remediation Note

Status: security-remediation Phases 1–5 are implemented in PR #9. Phase 6 live-deployment and exact-submission checks remain open.

## Phase 1 — Credential containment

A PostgreSQL credential was found in an older Git commit. Current project files use non-secret example values and pass the project secret scan. The project owner confirmed that the historical credential was rotated or disabled; that external action was not independently verified.

For the academic submission, use a history-free ZIP that excludes `.git`, local environment files, and the affected repository history. Before submission, run both commands against the current project and the exact final archive:

```bash
npm run security:check
npm run security:archive -- /path/to/submission.zip
```

The archive inspector rejects Git metadata, local `.env*` files other than `.env.example`, recognized nested archive containers, and common credential patterns within bounded entry sizes. It is designed to prevent accidental inclusion in this coursework submission; it does not claim to detect encrypted containers or every arbitrary text encoding.

## Phases 2–3 — Server-owned state and AI

- Browser state actions no longer accept Drafts, Active Plans, target snapshots, validation decisions, assistant messages, or arbitrary closed-answer labels and patches.
- Draft and adjustment approval loads the current stored proposal, checks its identifier and base Active Plan version, recalculates validation from authoritative profile/catalog data, and activates it only once.
- `/api/coach/message` is the only public AI entry point. The seven former onboarding, Draft, modification, adjustment, lookup, candidate, and estimate AI routes were removed.
- Typed approval text remains conversational. Food and plan changes require the current visible server-backed approval control.

## Phase 4 — Access and rate limits

- Production fails closed when the access code or a cookie-signing secret of at least 32 characters is unavailable; no fallback token or cookie is issued.
- Access-code verification is limited to five attempts per 15 minutes before checking the code.
- The application ignores client-controlled forwarding headers. Unauthenticated users intentionally share one anonymous pre-access bucket; verified sessions use a stable signed-session identity.

The shared anonymous bucket is an accepted academic-demo tradeoff: one visitor can temporarily consume the allowance for other unauthenticated visitors. Reintroducing an unverified IP header is not an acceptable workaround.

## Phase 5 — Deployment safeguards

- Production responses add CSP, HSTS, MIME-sniffing, referrer, and permissions headers. The CSP retains inline script/style compatibility and is not claimed as complete XSS prevention.
- Both application and migration PostgreSQL pools require certificate verification when TLS is required and reject URL TLS parameters that could replace the explicit configuration.
- Public JSON and stream failures use generic messages and safe codes rather than raw exceptions, database URLs, API keys, environment values, source payloads, or model internals.
- Regression coverage exercises forged state/transcript input, stale and invalid proposals, access failures, rate limits, removed routes, TLS options, response headers, error redaction, and archive inspection.

## Verification evidence

The completed implementation verification recorded formatting, lint, type checking, 215 passing unit tests, the project security scan, a production build, and 23 passing Chromium scenarios. Phase-specific evidence is stored under `docs/verification-results/`.

## Remaining Phase 6 gates

Read-only checks against `https://nutrition-coach-demo.onrender.com/` on 2026-09-14 found a healthy `/api/health` response and a valid browser-to-Render TLS certificate. The required Phase 5 production headers were absent, so the current live service is not yet verified as running the reviewed commit.

After PR #9 is merged and deployed:

1. record the deployed commit SHA and verify all required page/API headers;
2. confirm through authorized Render configuration or redacted logs that both migration and application connections validate the PostgreSQL certificate;
3. exercise the authenticated demo flow without guessing the shared code; and
4. run `npm run security:archive -- <final-submission.zip>` on the exact archive submitted.

Do not mark the complete security plan finished until these four gates are recorded without secret values.
