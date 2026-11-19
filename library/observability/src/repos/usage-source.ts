/** Chat turns and tool runs have separate owners. UNION ALL preserves one row per request
 * without reading the contents of transcripts, generated files or search results. */
export const REQUEST_SOURCE = `(
  SELECT project_id, ts, date, agent_id, session_id, provider, model_id, status,
    cache_read, cache_write, output, total,
    NULL AS operation, 0 AS registry_route_matched, NULL AS input_unit, NULL AS input_quantity, NULL AS completed_requests,
    NULL AS raw_cached, NULL AS raw_prompt, NULL AS raw_thoughts, NULL AS raw_response, NULL AS images
  FROM usage_records
  UNION ALL
  SELECT project_id, ts, date, agent_id, session_id, provider, model_id, status,
    i_cached, i_prompt, i_output, i_cached+i_prompt+i_output,
    operation, registry_route_matched, input_unit, input_quantity, completed_requests, cached, prompt, thoughts, response, images
  FROM (
    SELECT *, CASE WHEN token_unit THEN COALESCE(cached,0) ELSE 0 END AS i_cached,
              CASE WHEN token_unit THEN COALESCE(prompt,0) ELSE 0 END AS i_prompt,
              CASE WHEN token_unit THEN COALESCE(thoughts,0)+COALESCE(response,0) ELSE 0 END AS i_output
    FROM (
      SELECT u.*, r.run_id IS NOT NULL AS registry_route_matched, input_unit='token' OR (input_unit IS NULL AND operation IN ('t2t','i2t','voice-polish')) AS token_unit
      FROM tool_request_usage u LEFT JOIN tool_registry_routes r ON r.run_id=u.id
    )
  )
)`;

// Keep missing quantities separate from zero and from rows with complete telemetry.
// Otherwise a neighbouring run could lend its price or its image count to a failed request.
export const BILLING_GROUP = `operation, registry_route_matched, input_unit,
  (raw_cached IS NULL), (raw_prompt IS NULL), (raw_thoughts IS NULL), (raw_response IS NULL),
  (images IS NULL), (input_quantity IS NULL), (completed_requests IS NULL)`;
