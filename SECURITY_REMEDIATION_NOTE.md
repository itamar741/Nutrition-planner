# Security Remediation Note

Status: security-remediation Phases 1–5 are implemented through PRs #9 and #10. The academic live-deployment checks pass; exact final-submission archive inspection remains open.

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
- Both application and migration PostgreSQL pools require certificate verification when TLS is enabled and reject URL TLS parameters that could replace the explicit configuration.
- The academic Render Blueprint uses `fromDatabase.connectionString`, which supplies a same-region internal private-network URL, and leaves database TLS disabled because Render's internal TLS uses a self-signed certificate that cannot satisfy the selected certificate-verification policy. This exception is limited to the Render private network; external database URLs must use verified TLS.
- Production requires `DATABASE_URL` and fails closed rather than silently using the development/test memory adapter. The health and access routes return generic `503` responses when persistence is unavailable.
- Public JSON and stream failures use generic messages and safe codes rather than raw exceptions, database URLs, API keys, environment values, source payloads, or model internals.
- Regression coverage exercises forged state/transcript input, stale and invalid proposals, access failures, rate limits, removed routes, TLS options, response headers, error redaction, and archive inspection.

## Verification evidence

The latest local verification recorded formatting, lint, type checking, 219 passing unit tests, the project security scan, a production build, and 23 passing Chromium scenarios. Phase-specific evidence is stored under `docs/verification-results/`.

## Phase 6 deployment evidence

Read-only checks against `https://nutrition-coach-demo.onrender.com/` on 2026-09-14 found a healthy `/api/health` response, valid browser-to-Render TLS, and every required Phase 5 production header on both the page and health endpoint. That deployed health response predates the final production persistence guard and therefore does not independently prove that PostgreSQL was configured. After this branch is deployed, health returns `200` only after a configured PostgreSQL connection initializes successfully. The application does not expose a version endpoint, so the exact deployed commit SHA was not independently read from the public service.

Remaining gates:

1. Recheck `/api/health` after deploying the production persistence guard; and
2. run `npm run security:archive -- <final-submission.zip>` on the exact archive submitted.

An authorized live access request returned `200`, issued the signed cookie, and allowed a read-only request to a protected profile-state endpoint. The code and cookie were neither printed nor stored in evidence.

The expected deployed revision may also be recorded from Render or GitHub deployment metadata when available, but the application does not expose it and it is not a security acceptance gate for this assignment.

Do not mark the complete security plan finished until the archive gate is recorded without secret values. For this academic submission, the private-network database exception is accepted and must remain visible in the final documentation.
