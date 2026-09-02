# Nutrition Coach Demo

A narrow conversational nutrition-coach course project with exactly two shared demonstration journeys:

- **Fresh** — adaptive onboarding, food preferences, Draft generation, modification, and explicit activation.
- **Existing** — seeded profile, Active Plan, approximately two months of weight history, deterministic trend analysis, and conversational adjustment approval.

Turn 4 adds PostgreSQL-backed shared state, one shared access code, independent demo resets, and a bounded runtime-food workflow using OpenAI function calling, ScrapingBee, and Fuder.

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
