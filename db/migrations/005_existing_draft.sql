UPDATE demo_profiles
SET state = jsonb_set(
      state,
      '{agentSession}',
      (
        CASE
          WHEN jsonb_typeof(state->'agentSession') = 'object'
            THEN state->'agentSession'
          ELSE '{}'::jsonb
        END
      ) || '{"draftIntent":null}'::jsonb,
      true
    ),
    updated_at = now()
WHERE state->'agentSession' IS NULL
   OR jsonb_typeof(state->'agentSession') <> 'object'
   OR NOT (state->'agentSession' ? 'draftIntent');

UPDATE demo_profiles
SET state = jsonb_set(
      jsonb_set(
        state,
        '{draft}',
        COALESCE(state->'draft', 'null'::jsonb),
        true
      ),
      '{schemaVersion}',
      '2'::jsonb,
      true
    ),
    updated_at = now()
WHERE profile_id = 'existing'
  AND (
    state->>'schemaVersion' IS DISTINCT FROM '2'
    OR NOT (state ? 'draft')
  );
