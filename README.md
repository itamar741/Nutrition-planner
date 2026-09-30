# Live website
https://nutrition-coach-demo.onrender.com/

# Nutrition Coach Demo

A narrow conversational nutrition-coach course project with exactly two shared demonstration journeys:

- **Fresh** — adaptive onboarding, food preferences, Draft generation, modification, and explicit activation.
- **Existing** — seeded profile, Active Plan, approximately two months of weight history, ordinary same-target Draft planning, deterministic trend analysis, and conversational adjustment approval.

Turn 4 added PostgreSQL-backed shared state, one shared access code, and independent demo resets. Turn 5 added a bounded USDA FoodData Central workflow. Turn 6 validates and caches nutrition-complete candidates before display. Turn 7 introduced a unified coach. Turn 8 makes Arnold a durable role/content conversation with bounded skills, structured preferences, model-created Draft proposals, and server-owned validation. The current tool-first orchestration lets Arnold plan a sequence of bounded skills while the server remains authoritative over every effect.

Every free-text coach message reaches the server-owned Arnold agent with authoritative profile context, reset-scoped conversation history, and the complete documented skill set. Arnold chooses the sequence; deterministic code validates every schema, prerequisite, source-evidence rule, identifier, calculation, and state transition. Every turn must finish through a structured skill, answer, clarification, or independently reviewed out-of-scope outcome; unreviewed prose and unauthorized effects are not accepted. In short: **open planning, closed effects, structured outcomes**. Food insertion and Active Plan changes still require visible approval buttons.

Free-text plan creation and revision use one durable Plan Change lifecycle. Arnold may open the operation with `begin_plan_change` and then submit its complete continuation Draft, or submit a complete `new_request` Draft that creates the same operation before validation. This keeps an already-approved food request such as “add eggs to my meal plan” connected to a formal rebalanced Draft even after an earlier Create Draft offer was declined.

Rejected Draft candidates are durable too: each complete attempt and its calculated failure evidence is saved immediately. Remaining repair attempts continue automatically in the same turn, while the third rejection produces a review the user can inspect and deliberately retry.

The capability cards share one contract with Arnold. Their examples fill and reveal the chat composer without sending—including **Manage approved foods** with `Find Eggs and add it to my foods`—calculation questions reuse the deterministic explanations shown behind the plan, and the Fresh Generate Draft button is a typed model-backed action rather than synthetic conversation text.

Fresh exercise onboarding uses conditional completeness: an explicit no-exercise answer becomes a canonical zero-volume routine with no invented intensity, while active exercise still requires frequency, duration, and intensity. Partial answers are saved but remain visibly incomplete.

Arnold is limited conversationally to nutrition planning, food and basic meal preparation, weight tracking, and high-level non-medical fitness information. Programming, technical help, and unrelated requests receive a brief redirect rather than an answer. This conversational scope is model-guided; protected state changes remain independently enforced by server code.

## Security architecture

- The browser submits text or a narrow action with identifiers and optimistic-version metadata. It cannot submit an assistant message, replacement profile, Draft, target snapshot, validation result, or Active Plan.
- `/api/coach/message` is the only public AI entry point. The server loads stored proposals and authoritative profile/catalog state before validating any approval.
- Production access fails closed unless the shared code and a signing secret of at least 32 characters are configured. Five access-code attempts within 15 minutes exhaust the shared anonymous pre-access bucket; authenticated limits use only a verified signed-session identity.
- Production adds browser security headers and returns fixed public errors rather than raw internal messages. The database layer verifies certificates whenever TLS is enabled; the academic Render Blueprint instead uses its same-region private-network database URL without TLS as a documented deployment exception.
- Production requires `DATABASE_URL` and never falls back to temporary in-memory persistence. Development and automated tests may use the deterministic memory adapter.
- The submission ZIP must be checked separately with `npm run security:archive -- <archive.zip>`.

## Local verification

```bash
npm ci
npm run verify
```

Without `DATABASE_URL`, local development and automated tests use an in-memory repository. Production requires PostgreSQL and all variables listed in `.env.example`.

## Deployment

The project is configured as one Render Web Service plus one Render PostgreSQL database in `render.yaml`. See [docs/deployment.md](docs/deployment.md) for the required secrets, setup, and staging checklist.

The live Render service passed the public health, edge-TLS, production-header, PostgreSQL-initialization, and authenticated-read checks for the exact deployment revision recorded in [docs/verification-results/phase-6.md](docs/verification-results/phase-6.md). Later local architecture verification is tracked in the [agentic-flow roadmap](docs/agentic-flow-architecture-roadmap.md) and the latest [structured-turn-outcomes record](docs/verification-results/structured-turn-outcomes.md). Those records do not replace deployment verification: after deploying a newer revision, record its exact commit and rerun the staging and live-security checklist in [docs/deployment.md](docs/deployment.md). The final history-free submission ZIP passed the separate archive inspection; regenerate and reinspect it after any submitted-tree change.

## Safety boundary

The application is a course demonstration for healthy adults and is not medical advice. It has no accounts, general multi-user system, allergies or intolerances, personalized workout programming or tracking, adherence tracking, target weight, goal switching, plan history, weekly variation, or arbitrary AI/browser tools.
