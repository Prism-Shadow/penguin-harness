/**
 * plugin_module_requests table repo: who asked this server to run a plugin's server module, and
 * what an administrator decided, one row per package. What the rows mean and when they change is
 * the server's plugin-modules service; this only stores and reads them.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "@prismshadow/penguin-library-db";
import type {
  PluginModuleRequestRow,
  PluginModuleRequests,
  PluginModuleVia,
} from "../plugin-module-requests.js";

function rowOf(r: Record<string, unknown>): PluginModuleRequestRow {
  return {
    package: r.package as string,
    plugin: r.plugin as string,
    projectId: (r.project_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    requestedBy: r.requested_by as string,
    requestedAt: r.requested_at as string,
    decision: (r.decision as PluginModuleRequestRow["decision"]) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    via: (r.via as PluginModuleVia | null) ?? null,
  };
}

@Component()
export class PluginModuleRequestsRepo implements PluginModuleRequests {
  @Use() private readonly db!: Db;

  get(pkg: string): PluginModuleRequestRow | null {
    const r = this.db.prepare("SELECT * FROM plugin_module_requests WHERE package = ?").get(pkg);
    return r ? rowOf(r as Record<string, unknown>) : null;
  }

  list(): PluginModuleRequestRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM plugin_module_requests
         ORDER BY decision IS NOT NULL, COALESCE(decided_at, requested_at) DESC, package`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowOf);
  }

  upsert(row: PluginModuleRequestRow): void {
    this.db
      .prepare(
        `INSERT INTO plugin_module_requests
           (package, plugin, project_id, agent_id, requested_by, requested_at, decision, decided_by, decided_at, via)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(package) DO UPDATE SET
           plugin = excluded.plugin,
           project_id = excluded.project_id,
           agent_id = excluded.agent_id,
           requested_by = excluded.requested_by,
           requested_at = excluded.requested_at,
           decision = excluded.decision,
           decided_by = excluded.decided_by,
           decided_at = excluded.decided_at,
           via = excluded.via`,
      )
      .run(
        row.package,
        row.plugin,
        row.projectId,
        row.agentId,
        row.requestedBy,
        row.requestedAt,
        row.decision,
        row.decidedBy,
        row.decidedAt,
        row.via,
      );
  }

  decide(
    pkg: string,
    decision: "enabled" | "declined",
    by: string,
    at: string,
    via: PluginModuleVia | null,
  ): boolean {
    const result = this.db
      .prepare(
        "UPDATE plugin_module_requests SET decision = ?, decided_by = ?, decided_at = ?, via = ? WHERE package = ?",
      )
      .run(decision, by, at, via, pkg);
    return Number(result.changes) > 0;
  }

  pendingCount(): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM plugin_module_requests WHERE decision IS NULL")
      .get() as { n: number };
    return Number(r.n);
  }
}
