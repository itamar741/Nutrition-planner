CREATE TABLE IF NOT EXISTS demo_profiles (
  profile_id text PRIMARY KEY CHECK (profile_id IN ('new', 'existing')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_commands (
  profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE,
  command_id text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, command_id)
);

CREATE TABLE IF NOT EXISTS catalog_foods (
  id text PRIMARY KEY,
  normalized_identity text NOT NULL UNIQUE,
  source_identifier text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_lookups (
  id uuid PRIMARY KEY,
  profile_id text NOT NULL REFERENCES demo_profiles(profile_id),
  query text NOT NULL,
  context jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('searching', 'ready', 'failed', 'approved', 'rejected')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_candidates (
  id uuid PRIMARY KEY,
  lookup_id uuid NOT NULL REFERENCES food_lookups(id) ON DELETE CASCADE,
  source_url text,
  source_identifier text NOT NULL,
  status text NOT NULL CHECK (status IN ('summary', 'detailed', 'approved', 'rejected')),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lookup_id, source_identifier)
);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id bigserial PRIMARY KEY,
  session_hash text NOT NULL,
  ip_hash text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_events_created_at_idx
  ON rate_limit_events (created_at);
CREATE INDEX IF NOT EXISTS rate_limit_events_session_idx
  ON rate_limit_events (session_hash, created_at);
