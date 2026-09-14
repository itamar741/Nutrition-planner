# Pre-deployment Security Audit

## Objective

Review the complete `nutrition-coach` repository and its trust boundaries before deployment. The audit first produced findings without changing code; remediation then proceeded in separately verified phases.

## Scope

- Map every API route and trust boundary between the browser, Next.js, PostgreSQL, OpenAI, USDA, and Render.
- Review access controls: signed-cookie integrity and expiry, CSRF exposure, access-code brute force, profile separation, candidate ownership, and insecure direct object references.
- Review untrusted input and persistence: strict schemas, parameterized SQL, transactions, replay and idempotency, concurrency, stale versions, command injection, cross-site scripting, and error leakage.
- Review the AI boundary: prompt injection, tool allowlists, text that attempts to approve an action, direct Active Plan modification, and hostile external-source data.
- Review infrastructure and delivery: secrets and Git history, environment-file handling, dependencies, browser headers, Render configuration, database transport, proxy-header spoofing, rate limits, least privilege, audit evidence, and legacy routes.
- Run deterministic unit, API, security, build, and browser checks without relying on live AI or USDA calls.

## Audit acceptance criteria

- Findings are ranked `Critical / High / Medium / Low` and include a precise location, impact, exploitation scenario, evidence, and recommended correction.
- Every public API route and trust boundary receives a status of pass, finding, or not independently verifiable.
- No Critical or High finding remains without a clear disposition and remediation path.
- Code changes are reviewed and regression-tested separately from the read-only audit.

## Assumptions

- The audit covers the complete current branch, not only its diff from the base branch.
- Live Render checks are performed only with authorized access and never expose secret values.
- Environment files are reviewed by variable name, permissions, and Git tracking state; secret values are not printed in reports.
- This is an academic demonstration with documented constraints, not a production identity or health platform.

## Remediation status

- **Phase 1 — historical PostgreSQL credential:** the project owner confirmed rotation or disablement. The submission uses a history-free archive that excludes `.git` and local environment files. External rotation was not independently verified.
- **Phase 2 — browser-authoritative plans:** public state actions can no longer submit Drafts, target snapshots, validation decisions, activation times, or replacement Active Plans. Approval loads and validates the current server-stored proposal.
- **Phase 3 — AI and transcript trust boundary:** browser actions cannot write assistant messages or arbitrary closed-answer labels and patches. `/api/coach/message` is the only public AI entry point; seven direct AI routes were removed.
- **Phase 4 — access and identity:** production access fails closed, access-code attempts are limited, forged cookies do not create identities, and client-controlled forwarding headers are ignored.
- **Phase 5 — deployment safeguards:** production security headers, certificate verification whenever database TLS is enabled, rejection of conflicting database URL options, generic public errors, bounded final-archive inspection, and fail-closed production persistence were added. The academic Render deployment uses its same-region private-network database URL without TLS as an explicit exception.
- **Phase 6 — live verification:** the public health endpoint, browser-to-Render TLS, production headers, and one authorized authenticated read passed on 2026-09-14. The production persistence fix must be deployed and rechecked before the internal database gate passes; exact final-submission archive inspection is also pending.

## Control coverage

- **Authorization and object access:** the product intentionally exposes two shared demo profiles behind one signed access gate; it has no user accounts or tenant ownership model. Profile identifiers are allowlisted, stale writes require the current version, and proposal or candidate actions must resolve to the current server-stored interaction.
- **Injection resistance:** public payloads are strict-schema validated, persistence uses parameterized queries, no route exposes shell execution, React renders conversation text as data, and production CSP limits external content sources. The CSP permits inline framework content and is documented as defense in depth rather than complete XSS prevention.
- **Secrets and dependencies:** current files and the exact submission archive are scanned separately; Git history is excluded from the submission; environment values stay server-side; and dependency audit results are recorded with the verification evidence.
- **AI and external data:** user text and USDA content are untrusted. The model receives bounded sanitized context and state-dependent tools, while deterministic server code validates every proposal, candidate, and protected transition before persistence.
- **Least privilege and auditability:** browser requests carry only narrow facts and identifiers, AI helpers have no independent public routes, detailed diagnostics remain server-side, and command IDs, profile versions, stored interactions, test records, and Git commits provide the review trail.
- **Legacy-code containment:** historical design and verification records remain labelled as historical evidence. Removed AI routes stay absent, and tests assert that they return `404`.

No Critical finding remains. High findings have an implemented remediation or, for the historical credential, an owner-confirmed containment record and a history-free submission control. Known academic-demo tradeoffs and the remaining deployment and archive gates are documented in `SECURITY_REMEDIATION_NOTE.md` and `docs/verification-results/phase-6.md`.
