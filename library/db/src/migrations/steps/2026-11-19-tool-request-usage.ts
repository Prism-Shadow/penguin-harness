import type { Migration } from "../migration.js";

const fields = `id, project_id, agent_id, session_id, ts, date, provider, model_id,
  status, operation, input_unit, cached, prompt, thoughts, response, images`;

// Indexed quantities keep Cost Center queries off tool result text, search results and artifact lists.
// Only legacy runs with evidence of a provider call participate in the backfill.
function projectRuns(idCondition: string) {
  return `INSERT OR REPLACE INTO tool_request_usage (${fields})
    SELECT r.id, r.project_id, CASE WHEN s.project_id=r.project_id THEN s.agent_id END,
      CASE WHEN s.project_id IS NULL OR s.project_id=r.project_id THEN r.session_id END, r.created_at, date(r.created_at,'localtime'),
      r.data->>'$.model.provider', r.data->>'$.model.modelId',
      CASE WHEN r.status='cancelled' THEN 'aborted' ELSE r.status END,
      r.data->>'$.capability', r.data->>'$.inputMeter.unit',
      r.data->>'$.usage.cached_tokens', r.data->>'$.usage.prompt_tokens',
      r.data->>'$.usage.thoughts_tokens', r.data->>'$.usage.response_tokens',
      (SELECT j.value->>'$.quantity' FROM json_each(r.data,'$.measurements') j WHERE j.value->>'$.unit'='image' LIMIT 1)
    FROM capability_runs r
    LEFT JOIN sessions s ON s.session_id=r.session_id
    WHERE ${idCondition} AND r.data->>'$.model.provider' IS NOT NULL AND r.data->>'$.model.modelId' IS NOT NULL
      AND r.data->>'$.capability' IS NOT NULL AND r.status IN ('completed','failed','cancelled')
      AND COALESCE(r.data->>'$.providerAttempted',
        r.status='completed' OR r.data->>'$.error' GLOB 'The model provider returned HTTP [45][0-9][0-9].'
        OR r.data->>'$.error'='The model provider rate-limited this request.'
        OR EXISTS (SELECT 1 FROM json_each(r.data,'$.measurements') j
          WHERE j.value->>'$.unit'='request' AND j.value->>'$.quantity'>0))`;
}

export const TOOL_REQUEST_USAGE_V1 = `
CREATE TABLE IF NOT EXISTS tool_request_usage (
 id TEXT PRIMARY KEY REFERENCES capability_runs(id) ON DELETE CASCADE, project_id TEXT NOT NULL,
 agent_id TEXT, session_id TEXT, ts TEXT NOT NULL, date TEXT NOT NULL, provider TEXT NOT NULL,
 model_id TEXT NOT NULL, status TEXT NOT NULL, operation TEXT NOT NULL, input_unit TEXT,
 cached INTEGER, prompt INTEGER, thoughts INTEGER, response INTEGER, images INTEGER);
CREATE INDEX IF NOT EXISTS idx_tool_usage_project_date ON tool_request_usage(project_id,date);
CREATE INDEX IF NOT EXISTS idx_tool_usage_project_model ON tool_request_usage(project_id,provider,model_id);
CREATE TRIGGER IF NOT EXISTS tool_usage_on_insert AFTER INSERT ON capability_runs WHEN NEW.status!='running' BEGIN
 ${projectRuns("r.id=NEW.id")}; END;
CREATE TRIGGER IF NOT EXISTS tool_usage_on_finish AFTER UPDATE OF status,data ON capability_runs WHEN NEW.status!='running' BEGIN
 ${projectRuns("r.id=NEW.id")}; END;`;

export const toolRequestUsage: Migration = {
  name: "2026-11-19-tool-request-usage",
  swapSafe: true,
  up(db) {
    db.exec(TOOL_REQUEST_USAGE_V1);
    db.exec(projectRuns("1"));
  },
  down(db) {
    db.exec(
      "DROP TRIGGER IF EXISTS tool_usage_on_insert; DROP TRIGGER IF EXISTS tool_usage_on_finish; DROP TABLE IF EXISTS tool_request_usage",
    );
  },
};
