UPDATE food_lookups
SET status = 'failed',
    failure_code = 'source_retired',
    updated_at = now()
WHERE status IN ('searching', 'ready');
