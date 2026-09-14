# Phase 6 — Live Deployment Security Verification

Date: 2026-09-14

Target: `https://nutrition-coach-demo.onrender.com/`
Scope: public read-only checks plus one authorized access-code verification and protected read. No guessing, profile mutation, secret disclosure, or external-service configuration change was performed. A second check ran after PR #10 merged and the Render deployment became responsive.

## Revision scope

- The recorded successful Render deployment is deployment `6436916765` for merge commit `8457ba4`.
- The final implementation revision is merge commit `cf6c85b`, which adds the conversational topic boundary after the recorded deployment. Its deterministic, browser, and credentialed live-model evidence is recorded in [Coach topic-boundary verification](coach-topic-boundary.md). A later documentation-only reconciliation may follow without changing runtime code.
- No Render deployment identifier for `cf6c85b` is recorded, so this document does not claim that the exact final repository revision was deployed. The live checks below apply to the explicitly named deployed revision.
- The submission archive is generated directly from the final documentation commit as `nutrition-coach-submission-2026-09-14-final.zip`. Its Git revision and SHA-256 are recorded in the generated sidecar file beside the archive, avoiding a self-referential checksum inside the ZIP. The archive must be regenerated and reinspected after any later submitted-tree change.

## Results

| Check                                | Result | Evidence / next action                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public health endpoint               | Pass   | `GET /api/health` returned `200` with `{"ok":true}`.                                                                                                                                                                                                                                        |
| Public browser-to-Render TLS         | Pass   | The endpoint negotiated TLS 1.3 and its certificate chain verified successfully for `onrender.com`. This does not verify the internal Render-to-PostgreSQL connection.                                                                                                                      |
| Production security headers          | Pass   | The page and `/api/health` responses include CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. The initial pre-deployment check failed; the post-merge recheck passed.                                                                             |
| Authorized access and protected read | Pass   | One authorized code submission returned `200`, issued a signed cookie, and allowed a read-only request to `/api/demo/state/new`. No code or cookie value was printed or stored. Brute-force behavior remains covered by deterministic tests rather than live guessing.                      |
| PostgreSQL deployment path           | Pass   | GitHub recorded successful Render deployment `6436916765` for merge commit `8457ba4`. The following `/api/health` request returned `200`; the merged production guard allows that result only after a configured PostgreSQL connection initializes. No hostname or credential was recorded. |
| Final submission archive             | Pass   | The history-free `nutrition-coach-submission-2026-09-14-final.zip` generated directly from the final documentation commit passed `npm run security:archive`; the inspection scanned 169 project files. The sidecar beside the ZIP records its exact Git revision and SHA-256.               |

## Local remediation verification

- Formatting, lint, and type checking passed.
- All 219 unit and API tests passed, including production failures for missing persistence configuration.
- The project security scan and production build passed.
- All 23 Chromium scenarios passed against the production build using the explicit local-only memory-persistence test flag. The deployment configuration does not contain that flag.

## Deployment gate

All Phase 6 gates pass for the academic assignment within the revision scope above. This evidence does not collapse the deployed revision and the later final repository revision into one claim. If the submitted tree changes, regenerate the history-free ZIP and rerun the exact-file archive inspection. Do not record secrets in this file.
