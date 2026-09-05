import { foodCatalog } from "@/data/food-catalog";
import {
  createExistingDemoState,
  createNewDemoState,
} from "@/data/demo-fixtures";
import { getPool, hasPostgresConfiguration } from "./database";

const migrationSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS demo_profiles (profile_id text PRIMARY KEY CHECK (profile_id IN ('new', 'existing')), version integer NOT NULL DEFAULT 1 CHECK (version > 0), state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS demo_commands (profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE, command_id text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, command_id));
CREATE TABLE IF NOT EXISTS catalog_foods (id text PRIMARY KEY, normalized_identity text NOT NULL UNIQUE, source_identifier text NOT NULL UNIQUE, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS food_lookups (id uuid PRIMARY KEY, profile_id text NOT NULL REFERENCES demo_profiles(profile_id), query text NOT NULL, context jsonb NOT NULL, status text NOT NULL CHECK (status IN ('searching', 'ready', 'failed', 'approved', 'rejected')), failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS food_candidates (id uuid PRIMARY KEY, lookup_id uuid NOT NULL REFERENCES food_lookups(id) ON DELETE CASCADE, source_url text, source_identifier text NOT NULL, status text NOT NULL CHECK (status IN ('summary', 'detailed', 'approved', 'rejected')), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (lookup_id, source_identifier));
CREATE TABLE IF NOT EXISTS rate_limit_events (id bigserial PRIMARY KEY, session_hash text NOT NULL, ip_hash text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_turns (profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE, command_id text NOT NULL, expected_version integer NOT NULL, request jsonb NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')), result jsonb, failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, command_id));
ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS conversation_messages (sequence bigserial PRIMARY KEY, profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE, id text NOT NULL, turn_id text, role text NOT NULL CHECK (role IN ('user', 'assistant')), content text NOT NULL DEFAULT '', status text NOT NULL CHECK (status IN ('pending', 'partial', 'final', 'failed')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (profile_id, id));
CREATE TABLE IF NOT EXISTS conversation_activity_events (sequence bigserial PRIMARY KEY, profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE, id text NOT NULL, turn_id text, kind text NOT NULL CHECK (kind IN ('thinking', 'checking_foods', 'remembering_preference', 'searching_usda', 'reading_nutrition', 'validating_nutrition', 'creating_draft', 'checking_plan', 'revising_draft', 'user_action', 'failure')), label text NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (profile_id, id));
CREATE TABLE IF NOT EXISTS conversation_summaries (profile_id text PRIMARY KEY REFERENCES demo_profiles(profile_id) ON DELETE CASCADE, through_message_id text NOT NULL, digest jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_skill_calls (profile_id text NOT NULL, command_id text NOT NULL, sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 4), name text NOT NULL, arguments jsonb NOT NULL, result jsonb, status text NOT NULL CHECK (status IN ('pending', 'completed', 'rejected', 'failed')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, command_id, sequence), FOREIGN KEY (profile_id, command_id) REFERENCES agent_turns(profile_id, command_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS rate_limit_events_created_at_idx ON rate_limit_events (created_at);
CREATE INDEX IF NOT EXISTS rate_limit_events_session_idx ON rate_limit_events (session_hash, created_at);
CREATE INDEX IF NOT EXISTS agent_turns_active_idx ON agent_turns (profile_id, status, updated_at);
CREATE INDEX IF NOT EXISTS conversation_messages_profile_sequence_idx ON conversation_messages (profile_id, sequence);
CREATE INDEX IF NOT EXISTS conversation_activity_profile_sequence_idx ON conversation_activity_events (profile_id, sequence);
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
  await pool.query(
    `UPDATE demo_profiles
     SET state = jsonb_set(
       state,
       '{agentSession}',
       '{"summary":null,"preferences":[],"pendingInteraction":null,"pausedInteraction":null}'::jsonb,
       true
     ), updated_at = now()
     WHERE state->'agentSession' IS NULL`,
  );
  await pool.query(
    `UPDATE demo_profiles
     SET state = jsonb_set(state, '{agentSession,preferences}', '[]'::jsonb, true),
         updated_at = now()
     WHERE state->'agentSession'->'preferences' IS NULL`,
  );
  await pool.query(
    `INSERT INTO conversation_messages
       (profile_id, id, role, content, status, created_at, updated_at)
     SELECT profiles.profile_id, message.value->>'id', message.value->>'role',
            COALESCE(message.value->>'content', message.value->>'text', ''), 'final',
            profiles.updated_at + ((message.ordinality - 1) * interval '1 millisecond'),
            profiles.updated_at + ((message.ordinality - 1) * interval '1 millisecond')
     FROM demo_profiles AS profiles
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(profiles.state->'messages', '[]'::jsonb))
       WITH ORDINALITY AS message(value, ordinality)
     WHERE message.value->>'role' IN ('user', 'assistant')
       AND message.value->>'id' IS NOT NULL
     ON CONFLICT (profile_id, id) DO NOTHING`,
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
