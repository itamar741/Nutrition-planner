CREATE TABLE IF NOT EXISTS conversation_messages (
  sequence bigserial PRIMARY KEY,
  profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE,
  id text NOT NULL,
  turn_id text,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'partial', 'final', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, id)
);

CREATE INDEX IF NOT EXISTS conversation_messages_profile_sequence_idx
  ON conversation_messages (profile_id, sequence);

CREATE TABLE IF NOT EXISTS conversation_activity_events (
  sequence bigserial PRIMARY KEY,
  profile_id text NOT NULL REFERENCES demo_profiles(profile_id) ON DELETE CASCADE,
  id text NOT NULL,
  turn_id text,
  kind text NOT NULL CHECK (kind IN (
    'thinking', 'checking_foods', 'remembering_preference', 'searching_usda',
    'reading_nutrition', 'validating_nutrition', 'creating_draft',
    'checking_plan', 'revising_draft', 'user_action', 'failure'
  )),
  label text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, id)
);

CREATE INDEX IF NOT EXISTS conversation_activity_profile_sequence_idx
  ON conversation_activity_events (profile_id, sequence);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  profile_id text PRIMARY KEY REFERENCES demo_profiles(profile_id) ON DELETE CASCADE,
  through_message_id text NOT NULL,
  digest jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_skill_calls (
  profile_id text NOT NULL,
  command_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 4),
  name text NOT NULL,
  arguments jsonb NOT NULL,
  result jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'rejected', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, command_id, sequence),
  FOREIGN KEY (profile_id, command_id)
    REFERENCES agent_turns(profile_id, command_id) ON DELETE CASCADE
);

ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;

INSERT INTO conversation_messages (profile_id, id, role, content, status, created_at, updated_at)
SELECT
  profiles.profile_id,
  message.value->>'id',
  message.value->>'role',
  COALESCE(message.value->>'content', message.value->>'text', ''),
  'final',
  profiles.updated_at + ((message.ordinality - 1) * interval '1 millisecond'),
  profiles.updated_at + ((message.ordinality - 1) * interval '1 millisecond')
FROM demo_profiles AS profiles
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(profiles.state->'messages', '[]'::jsonb))
  WITH ORDINALITY AS message(value, ordinality)
WHERE message.value->>'role' IN ('user', 'assistant')
  AND message.value->>'id' IS NOT NULL
ON CONFLICT (profile_id, id) DO NOTHING;
