# Phase 6 — Live Deployment Security Verification

Date: 2026-09-14

Target: `https://nutrition-coach-demo.onrender.com/`
Scope: read-only public checks; no access-code guesses, authenticated requests, writes, or external-service configuration changes.

## Results

| Check                               | Result              | Evidence / next action                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public health endpoint              | Pass                | `GET /api/health` returned `200` with `{"ok":true}`.                                                                                                                                                                                             |
| Public browser-to-Render TLS        | Pass                | The endpoint negotiated TLS 1.3 and its certificate chain verified successfully for `onrender.com`. This does not verify the internal Render-to-PostgreSQL connection.                                                                           |
| Production security headers         | Fail / not deployed | The page and `/api/health` responses did not include the Phase 5 CSP, HSTS, MIME-sniffing, referrer, or permissions headers. Treat the live service as an older or misconfigured deployment until the reviewed commit is deployed and rechecked. |
| Access-code and rate-limit behavior | Not verified        | No known demonstration code was supplied and no guessing was performed, to avoid consuming the shared pre-access attempt bucket.                                                                                                                 |
| PostgreSQL certificate validation   | Not verified        | Requires an authorized Render deployment/log check confirming the Web Service and migration connection use `DATABASE_SSL=require` with certificate verification enabled.                                                                         |
| Final submission archive            | Not verified        | Run `npm run security:archive -- <final-submission.zip>` on the exact archive submitted to the course.                                                                                                                                           |

## Deployment gate

Do not mark Phase 6 complete until the deployed reviewed commit returns the required production headers and an authorized Render check confirms the database TLS certificate path. Record the deployed commit SHA and the recheck date here without recording secrets.
