/**
 * plugin_module_preinstalls table repo: the preinstalled built-in packages this server has
 * listed once in every Project it had (PRFC-0030), one row per package — and the ledger row
 * (plugin_module_requests, PRFC-0031) such a listing seeds, so an administrator sees the module
 * and can stop it. When the listing happens and what it writes is the server's; this only
 * stores and reads the two records.
 *
 * A plain class over the database rather than a tree component: the one-time listing runs when
 * a generation boots, before its module tree exists (it has to, to come before the closure is
 * read), and the plugin-modules service reads the same rows from inside the tree.
 */
import type { DatabaseSync } from "node:sqlite";

export class PluginModulePreinstallsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Whether this server already listed `pkg` in the Projects it had. */
  has(pkg: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM plugin_module_preinstalls WHERE package = ?").get(pkg) !==
      undefined
    );
  }

  /** An administrator's standing stop of `pkg` on this server: its ledger row says declined. */
  declined(pkg: string): boolean {
    const row = this.db
      .prepare("SELECT decision FROM plugin_module_requests WHERE package = ?")
      .get(pkg) as { decision: string | null } | undefined;
    return row?.decision === "declined";
  }

  /**
   * Records the one-time listing of `pkg`. Its ledger row is seeded first, when nobody ever
   * asked for the package — enabled, built in, by no one, for no Project — and a row waiting
   * for a decision is decided the same way, since the module now runs; a row an administrator
   * decided stays as it is. Then the package is recorded. In that order, a process that stops
   * between the two leaves the package unrecorded, and the next boot lists it again, which
   * changes nothing where it is listed. Answers whether this call recorded it (false: another
   * boot did first).
   */
  record(pkg: string, plugin: string, at: string): boolean {
    this.db
      .prepare(
        `INSERT INTO plugin_module_requests
           (package, plugin, project_id, agent_id, requested_by, requested_at, decision, decided_by, decided_at, via)
         VALUES (?, ?, NULL, NULL, '', ?, 'enabled', '', ?, 'builtin')
         ON CONFLICT(package) DO UPDATE SET
           decision = 'enabled', decided_by = '', decided_at = excluded.decided_at, via = 'builtin'
         WHERE plugin_module_requests.decision IS NULL`,
      )
      .run(pkg, plugin, at, at);
    const result = this.db
      .prepare("INSERT OR IGNORE INTO plugin_module_preinstalls (package, listed_at) VALUES (?, ?)")
      .run(pkg, at);
    return Number(result.changes) > 0;
  }
}
