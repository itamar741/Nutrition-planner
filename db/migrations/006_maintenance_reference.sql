UPDATE demo_profiles AS profiles
SET state = jsonb_set(
      profiles.state,
      '{activePlan,maintenanceReferenceWeightKg}',
      COALESCE(
        (
          SELECT to_jsonb(AVG((measurement.value->>'weightKg')::numeric))
          FROM jsonb_array_elements(
            COALESCE(profiles.state->'measurements', '[]'::jsonb)
          ) WITH ORDINALITY AS measurement(value, ordinality)
          WHERE measurement.ordinality <= 7
        ),
        'null'::jsonb
      ),
      true
    ),
    updated_at = now()
WHERE profiles.profile_id = 'existing'
  AND jsonb_typeof(profiles.state->'activePlan') = 'object'
  AND NOT (profiles.state->'activePlan' ? 'maintenanceReferenceWeightKg');
