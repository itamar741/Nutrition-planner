-- Upgrade reset-scoped profile aggregates to the durable tool-first Plan Change shape.
-- Existing conversations, foods, Drafts, plans, and interactions are preserved.

UPDATE demo_profiles
SET state = jsonb_set(
      state,
      '{agentSession,planChange}',
      (state->'agentSession'->'planChange') || jsonb_build_object(
        'id', COALESCE(
          state->'agentSession'->'planChange'->'id',
          to_jsonb('legacy-' || profile_id || '-' || version::text)
        ),
        'status', COALESCE(
          state->'agentSession'->'planChange'->'status',
          CASE state->'agentSession'->'pendingInteraction'->>'type'
            WHEN 'food_candidates' THEN '"awaiting_food_approval"'::jsonb
            WHEN 'food_approval' THEN '"awaiting_food_approval"'::jsonb
            WHEN 'existing_food' THEN '"awaiting_food_approval"'::jsonb
            WHEN 'confirm_draft_food' THEN '"awaiting_draft_confirmation"'::jsonb
            WHEN 'draft_approval' THEN '"draft_pending_approval"'::jsonb
            WHEN 'draft_failure_review' THEN '"failure_review"'::jsonb
            ELSE '"ready_for_draft"'::jsonb
          END
        ),
        'sourceMessageId', COALESCE(
          state->'agentSession'->'planChange'->'sourceMessageId',
          'null'::jsonb
        ),
        'requestEvidence', COALESCE(
          state->'agentSession'->'planChange'->'requestEvidence',
          'null'::jsonb
        ),
        'unresolvedFoodNames', COALESCE(
          state->'agentSession'->'planChange'->'unresolvedFoodNames',
          '[]'::jsonb
        ),
        'currentDraftId', COALESCE(
          state->'agentSession'->'planChange'->'currentDraftId',
          state->'draft'->'id',
          'null'::jsonb
        )
      ),
      true
    ),
    updated_at = now()
WHERE jsonb_typeof(state->'agentSession'->'planChange') = 'object';

UPDATE demo_profiles
SET state = jsonb_set(
      jsonb_set(
        jsonb_set(
          state,
          '{agentSession,pendingInteraction}',
          CASE
            WHEN jsonb_typeof(state->'agentSession'->'pendingInteraction') = 'object'
              AND jsonb_typeof(state->'agentSession'->'planChange') = 'object'
              AND state->'agentSession'->'pendingInteraction'->>'type' IN (
                'food_candidates', 'food_approval', 'existing_food',
                'confirm_draft_food', 'source_unavailable', 'draft_approval',
                'draft_failure_review'
              )
            THEN (state->'agentSession'->'pendingInteraction') || jsonb_build_object(
              'planChangeId', state->'agentSession'->'planChange'->'id'
            )
            ELSE state->'agentSession'->'pendingInteraction'
          END,
          true
        ),
        '{agentSession,pausedInteraction}',
        CASE
          WHEN jsonb_typeof(state->'agentSession'->'pausedInteraction') = 'object'
            AND jsonb_typeof(state->'agentSession'->'planChange') = 'object'
            AND state->'agentSession'->'pausedInteraction'->>'type' IN (
              'food_candidates', 'food_approval', 'existing_food',
              'confirm_draft_food', 'source_unavailable', 'draft_approval',
              'draft_failure_review'
            )
          THEN (state->'agentSession'->'pausedInteraction') || jsonb_build_object(
            'planChangeId', state->'agentSession'->'planChange'->'id'
          )
          ELSE state->'agentSession'->'pausedInteraction'
        END,
        true
      ),
      '{schemaVersion}',
      '3'::jsonb,
      true
    ),
    updated_at = now()
WHERE state->>'schemaVersion' IS DISTINCT FROM '3';
