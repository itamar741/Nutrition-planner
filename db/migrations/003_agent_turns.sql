CREATE TABLE IF NOT EXISTS agent_turns (
  profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE,
  command_id text NOT NULL,
  expected_version integer NOT NULL,
  request jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  result jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, command_id)
);

CREATE INDEX IF NOT EXISTS agent_turns_active_idx
  ON agent_turns (profile_id, status, updated_at);
