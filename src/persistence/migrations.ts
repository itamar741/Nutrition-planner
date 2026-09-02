import { foodCatalog } from "@/data/food-catalog";
import {
  createExistingDemoState,
  createNewDemoState,
} from "@/data/demo-fixtures";
import { getPool, hasPostgresConfiguration } from "./database";

const migrationSql = `
CREATE TABLE IF NOT EXISTS demo_profiles (profile_id text PRIMARY KEY CHECK (profile_id IN ('new', 'existing')), version integer NOT NULL DEFAULT 1 CHECK (version > 0), state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS demo_commands (profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE, command_id text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, command_id));
CREATE TABLE IF NOT EXISTS catalog_foods (id text PRIMARY KEY, normalized_identity text NOT NULL UNIQUE, source_identifier text NOT NULL UNIQUE, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS food_lookups (id uuid PRIMARY KEY, profile_id text NOT NULL REFERENCES demo_profiles(profile_id), query text NOT NULL, context jsonb NOT NULL, status text NOT NULL CHECK (status IN ('searching', 'ready', 'failed', 'approved', 'rejected')), failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS food_candidates (id uuid PRIMARY KEY, lookup_id uuid NOT NULL REFERENCES food_lookups(id) ON DELETE CASCADE, source_url text, source_identifier text NOT NULL, status text NOT NULL CHECK (status IN ('summary', 'detailed', 'approved', 'rejected')), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (lookup_id, source_identifier));
CREATE TABLE IF NOT EXISTS rate_limit_events (id bigserial PRIMARY KEY, session_hash text NOT NULL, ip_hash text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS rate_limit_events_created_at_idx ON rate_limit_events (created_at);
CREATE INDEX IF NOT EXISTS rate_limit_events_session_idx ON rate_limit_events (session_hash, created_at);
`;

let initialization: Promise<void> | null = null;

function normalizedIdentity(name: string, preparation: string, brand?: string) {
  return `${name} ${preparation} ${brand ?? ""}`
    .trim()
    .toLocaleLowerCase("en-US");
}

function sourceIdentifier(food: (typeof foodCatalog)[number]) {
  if (food.source.provider === "USDA FoodData Central") {
    return `usda:${food.source.fdcId}`;
  }
  return `foodsdictionary:${food.source.url}`;
}

async function initializePostgres() {
  const pool = getPool();
  await pool.query(migrationSql);
  await pool.query(
    `INSERT INTO demo_profiles (profile_id, version, state)
     VALUES ('new', 1, $1::jsonb), ('existing', 1, $2::jsonb)
     ON CONFLICT (profile_id) DO NOTHING`,
    [
      JSON.stringify(createNewDemoState()),
      JSON.stringify(createExistingDemoState()),
    ],
  );
  for (const food of foodCatalog) {
    await pool.query(
      `INSERT INTO catalog_foods (id, normalized_identity, source_identifier, data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        food.id,
        normalizedIdentity(
          food.displayName,
          food.preparation,
          "brand" in food && typeof food.brand === "string"
            ? food.brand
            : undefined,
        ),
        sourceIdentifier(food),
        JSON.stringify({ ...food, kosherReview: "reviewed" }),
      ],
    );
  }
}

export async function ensurePersistenceInitialized() {
  if (!hasPostgresConfiguration()) return;
  initialization ??= initializePostgres().catch((error) => {
    initialization = null;
    throw error;
  });
  await initialization;
}
