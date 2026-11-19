/**
 * plugin_module_preinstalls table repo: the preinstalled built-in modules (PRFC-0030) this server
 * has handled for each Project, one row per package and Project. When a pair is handled is the
 * server's; this only stores and reads the rows. Built outside a tree too (`wire`): the one-time
 * listing runs while a generation boots, before its module tree exists.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "@prismshadow/penguin-library-db";
import type { PluginModulePreinstalls } from "../plugin-module-preinstalls.js";

@Component()
export class PluginModulePreinstallsRepo implements PluginModulePreinstalls {
  @Use() private readonly db!: Db;

  projectsOf(pkg: string): string[] {
    const rows = this.db
      .prepare("SELECT project_id FROM plugin_module_preinstalls WHERE package = ?")
      .all(pkg) as Array<{ project_id: string }>;
    return rows.map((r) => r.project_id);
  }

  record(pkg: string, projectIds: readonly string[], at: string): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO plugin_module_preinstalls (package, project_id, listed_at) VALUES (?, ?, ?)",
    );
    for (const projectId of projectIds) insert.run(pkg, projectId, at);
  }
}
