# Nutrition Coach Demo

A narrow conversational nutrition-coach course project with exactly two shared demonstration journeys:

- **Fresh** — adaptive onboarding, food preferences, Draft generation, modification, and explicit activation.
- **Existing** — seeded profile, Active Plan, approximately two months of weight history, deterministic trend analysis, and conversational adjustment approval.

Turn 4 added PostgreSQL-backed shared state, one shared access code, and independent demo resets. Turn 5 added a bounded USDA FoodData Central workflow. Turn 6 validates and caches nutrition-complete candidates before display. Turn 7 replaces the disconnected chat-like paths with one streaming, state-aware coach whose conversation and interactions survive reloads.

Every free-text coach message reaches the unified server-owned agent with the authoritative profile context and reset-scoped conversation history. The model can request only state-dependent bounded tools; deterministic code validates and executes them. Food insertion and Active Plan changes still require visible approval buttons.

## Local verification

```bash
npm ci
npm run verify
```

Without `DATABASE_URL`, local development and automated tests use an in-memory repository. Production requires PostgreSQL and all variables listed in `.env.example`.

## Deployment

The project is configured as one Render Web Service plus one Render PostgreSQL database in `render.yaml`. See [docs/deployment.md](docs/deployment.md) for the required secrets, setup, and staging checklist.

## Safety boundary

The application is a course demonstration for healthy adults and is not medical advice. It has no accounts, general multi-user system, allergies or intolerances, workout tracking, adherence tracking, target weight, goal switching, plan history, weekly variation, or arbitrary AI/browser tools.
