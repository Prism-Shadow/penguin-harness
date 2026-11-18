/** Each provider operation has one owner: chat turns in usage_records, model tools in the
 * narrow projection of capability_runs. Both sides remain independently indexable by SQLite. */
export const REQUEST_SOURCE = `(
  SELECT project_id, ts, date, agent_id, session_id, provider, model_id, status,
    cache_read, cache_write, output, total, 'chat' AS billing,
    NULL AS raw_cached, NULL AS raw_prompt, NULL AS raw_thoughts, NULL AS raw_response, NULL AS images
  FROM usage_records
  UNION ALL
  SELECT project_id, ts, date, agent_id, session_id, provider, model_id, status,
    i_cached, i_prompt, i_output, i_cached+i_prompt+i_output,
    CASE WHEN operation='image' THEN 'image'
         WHEN token_unit AND prompt IS NOT NULL AND (thoughts IS NOT NULL OR response IS NOT NULL) THEN 'token'
         ELSE 'unknown' END,
    cached, prompt, thoughts, response, images
  FROM (
    SELECT *, CASE WHEN token_unit THEN COALESCE(cached,0) ELSE 0 END AS i_cached,
              CASE WHEN token_unit THEN COALESCE(prompt,0) ELSE 0 END AS i_prompt,
              CASE WHEN token_unit THEN COALESCE(thoughts,0)+COALESCE(response,0) ELSE 0 END AS i_output
    FROM (
      SELECT *, input_unit='token' OR (input_unit IS NULL AND operation IN ('t2t','i2t','voice-polish')) AS token_unit
      FROM tool_request_usage
    )
  )
)`;

// A run missing a quantity cannot borrow it from a priced neighbour. For image operations
// aggregate only rows with the same availability of every tariff input before estimating.
export const BILLING_GROUP = `billing,
  CASE WHEN billing='image' THEN
    (raw_cached IS NULL)+2*(raw_prompt IS NULL)+4*(raw_thoughts IS NULL)+8*(raw_response IS NULL)+16*(images IS NULL)
  ELSE 0 END`;
