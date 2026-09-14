# Phase 6 — Live Deployment Security Verification

Date: 2026-09-14

Target: `https://nutrition-coach-demo.onrender.com/`
Scope: public read-only checks plus one authorized access-code verification and protected read. No guessing, profile mutation, secret disclosure, or external-service configuration change was performed. A second check ran after PR #10 merged and the Render deployment became responsive.

## Results

| Check                                | Result               | Evidence / next action                                                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public health endpoint               | Pass                 | `GET /api/health` returned `200` with `{"ok":true}`.                                                                                                                                                                                                                                             |
| Public browser-to-Render TLS         | Pass                 | The endpoint negotiated TLS 1.3 and its certificate chain verified successfully for `onrender.com`. This does not verify the internal Render-to-PostgreSQL connection.                                                                                                                           |
| Production security headers          | Pass                 | The page and `/api/health` responses include CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. The initial pre-deployment check failed; the post-merge recheck passed.                                                                                  |
| Authorized access and protected read | Pass                 | One authorized code submission returned `200`, issued a signed cookie, and allowed a read-only request to `/api/demo/state/new`. No code or cookie value was printed or stored. Brute-force behavior remains covered by deterministic tests rather than live guessing.                           |
| PostgreSQL deployment path           | Pending redeployment | `render.yaml` obtains `DATABASE_URL` from `fromDatabase.connectionString`, which Render defines as the internal URL. The new production fail-closed check must be deployed before a health `200` can prove that PostgreSQL initialized successfully. No hostname or credential will be recorded. |
| Final submission archive             | Not verified         | Run `npm run security:archive -- <final-submission.zip>` on the exact archive submitted to the course.                                                                                                                                                                                           |

## Local remediation verification

- Formatting, lint, and type checking passed.
- All 219 unit and API tests passed, including production failures for missing persistence configuration.
- The project security scan and production build passed.
- All 23 Chromium scenarios passed against the production build using the explicit local-only memory-persistence test flag. The deployment configuration does not contain that flag.

## Deployment gate

The current public endpoint passes health, edge TLS, headers, and authorized access, but the new production persistence check still requires deployment and a health recheck. Phase 6 also remains open for inspecting the exact final submission ZIP after the final commit is merged. Deployment metadata may be added when available, but is not an acceptance gate because the application does not expose its revision. Do not record secrets in this file.
