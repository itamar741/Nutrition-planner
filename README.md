# Nutrition Coach Demo

A narrow conversational nutrition-coach course project with exactly two shared demonstration journeys:

- **Fresh** — adaptive onboarding, food preferences, Draft generation, modification, and explicit activation.
- **Existing** — seeded profile, Active Plan, approximately two months of weight history, ordinary same-target Draft planning, deterministic trend analysis, and conversational adjustment approval.

Turn 4 added PostgreSQL-backed shared state, one shared access code, and independent demo resets. Turn 5 added a bounded USDA FoodData Central workflow. Turn 6 validates and caches nutrition-complete candidates before display. Turn 7 introduced a unified coach. Turn 8 makes Arnold a durable role/content conversation with bounded, state-dependent skills, structured preferences, model-created Draft proposals, and server-owned validation.

Every free-text coach message reaches the server-owned Arnold agent with authoritative profile context and reset-scoped conversation history. Arnold can request only state-dependent bounded skills; deterministic code validates and executes them. Food insertion and Active Plan changes still require visible approval buttons.

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

The live Render service passes the public health, edge-TLS, production-header, PostgreSQL-initialization, and authenticated-read checks. The history-free final submission ZIP also passed the separate archive inspection. Current evidence is recorded in [docs/verification-results/phase-6.md](docs/verification-results/phase-6.md); regenerate and reinspect the ZIP if the submitted tree changes.

## Safety boundary

The application is a course demonstration for healthy adults and is not medical advice. It has no accounts, general multi-user system, allergies or intolerances, personalized workout programming or tracking, adherence tracking, target weight, goal switching, plan history, weekly variation, or arbitrary AI/browser tools.
