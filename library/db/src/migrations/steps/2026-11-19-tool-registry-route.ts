import type { Migration } from "../migration.js";

// Only confirmed routes have a row. Keep this evidence with the derived request, so
// a provider edit today cannot change which registry price yesterday's request used.
export const TOOL_REGISTRY_ROUTE = `
CREATE TABLE IF NOT EXISTS tool_registry_routes (
  run_id TEXT PRIMARY KEY REFERENCES tool_request_usage(id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS tool_registry_route_on_projection AFTER INSERT ON tool_request_usage
WHEN (SELECT json_type(data, '$.registryRouteMatched') FROM capability_runs WHERE id=NEW.id) = 'true'
BEGIN INSERT OR IGNORE INTO tool_registry_routes(run_id) VALUES (NEW.id); END;`;

export const toolRegistryRoute: Migration = {
  name: "2026-11-19-tool-registry-route",
  swapSafe: true,
  up(db) {
    db.exec(TOOL_REGISTRY_ROUTE);
    db.exec(`INSERT OR IGNORE INTO tool_registry_routes(run_id)
      SELECT r.id FROM capability_runs r JOIN tool_request_usage u ON u.id=r.id
      WHERE json_type(r.data, '$.registryRouteMatched')='true'`);
  },
  down(db) {
    db.exec(
      "DROP TRIGGER IF EXISTS tool_registry_route_on_projection; DROP TABLE IF EXISTS tool_registry_routes",
    );
  },
};
