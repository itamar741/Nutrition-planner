# Phase 6 — Live Deployment Security Verification

Date: 2026-09-14

Target: `https://nutrition-coach-demo.onrender.com/`
Scope: public read-only checks plus one authorized access-code verification and protected read. No guessing, profile mutation, secret disclosure, or external-service configuration change was performed. A second check ran after PR #10 merged and the Render deployment became responsive.

## Results

| Check                                | Result | Evidence / next action                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public health endpoint               | Pass   | `GET /api/health` returned `200` with `{"ok":true}`.                                                                                                                                                                                                                                        |
| Public browser-to-Render TLS         | Pass   | The endpoint negotiated TLS 1.3 and its certificate chain verified successfully for `onrender.com`. This does not verify the internal Render-to-PostgreSQL connection.                                                                                                                      |
| Production security headers          | Pass   | The page and `/api/health` responses include CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. The initial pre-deployment check failed; the post-merge recheck passed.                                                                             |
| Authorized access and protected read | Pass   | One authorized code submission returned `200`, issued a signed cookie, and allowed a read-only request to `/api/demo/state/new`. No code or cookie value was printed or stored. Brute-force behavior remains covered by deterministic tests rather than live guessing.                      |
| PostgreSQL deployment path           | Pass   | GitHub recorded successful Render deployment `6436916765` for merge commit `8457ba4`. The following `/api/health` request returned `200`; the merged production guard allows that result only after a configured PostgreSQL connection initializes. No hostname or credential was recorded. |
| Final submission archive             | Pass   | The history-free `nutrition-coach-submission-2026-09-14.zip` generated from the final merged tree passed `npm run security:archive`. It contains no Git history or local environment file; `.env.example` is the permitted template.                                                        |

## Local remediation verification

- Formatting, lint, and type checking passed.
- All 219 unit and API tests passed, including production failures for missing persistence configuration.
- The project security scan and production build passed.
- All 23 Chromium scenarios passed against the production build using the explicit local-only memory-persistence test flag. The deployment configuration does not contain that flag.

## Deployment gate

All Phase 6 gates pass for the academic assignment. If the submitted tree changes, regenerate the history-free ZIP and rerun the exact-file archive inspection. Do not record secrets in this file.
