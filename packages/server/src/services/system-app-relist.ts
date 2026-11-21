/**
 * The modules behind system apps (plugin/system-app-modules.ts), listed again at every boot in
 * each Project that lacks them: no route can unlist one, but a hand edit of `.project_config.toml`
 * can, and the system Agent's apps are never stopped.
 *
 * WHEN. Every boot of a generation, right after the one-time listing of preinstalled modules and
 * before the plugin closure is read (hmr/platform.ts), so the generation boots with them and no
 * re-assembly follows.
 *
 * WHAT. For every Project whose effective table for this server (the shared table and this
 * server's own) lacks such a module, this server's own `[plugins.<machineId>]` table gains it;
 * nothing else of the file changes, and every Project changed is a log line. Nothing is recorded:
 * the check is the table itself, so the next boot does it again. A Project whose config cannot be
 * read, written or parsed is logged and tried again at the next boot.
 *
 * THE LEDGER. A module whose ledger row is not enabled — an administrator stopped it under a build
 * where it provided no system app yet — is enabled again by the system, built in, and that is a
 * log line too; a missing row is written the same way, so the administrator sees it.
 */
import type { PluginModuleRequests } from "@prismshadow/penguin-library-setting";
import { listProjectIds, type PluginBase } from "../plugin/loader.js";
import { systemAppModules } from "../plugin/system-app-modules.js";
import { listInOwnTable } from "./own-table-listing.js";

export interface SystemAppRelistDeps {
  ledger: PluginModuleRequests;
  root: string;
  /** The plugin bases of the generation booting (its own assets, not the committed ones). */
  bases: readonly PluginBase[];
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  now: () => string;
  log: (line: string) => void;
}

/** Lists each module behind a system app in every Project that lacks it. Never throws. */
export async function relistSystemAppModules(deps: SystemAppRelistDeps): Promise<void> {
  try {
    const modules = await systemAppModules(deps.bases);
    if (modules.length === 0) return;
    const at = deps.now();
    for (const { package: pkg, plugin } of modules) {
      const row = deps.ledger.get(pkg);
      if (row === null) {
        deps.ledger.upsert({
          package: pkg,
          plugin,
          projectId: null,
          agentId: null,
          requestedBy: "",
          requestedAt: at,
          decision: "enabled",
          decidedBy: "",
          decidedAt: at,
          via: "builtin",
        });
      } else if (row.decision !== "enabled") {
        deps.ledger.decide(pkg, "enabled", "", at, "builtin");
        deps.log(`[plugins] module ${pkg}: enabled again, it provides a system app`);
      }
    }
    const packages = modules.map((m) => m.package);
    for (const projectId of await listProjectIds(deps.root)) {
      try {
        const added = await listInOwnTable(deps.root, projectId, deps.machineId, packages);
        for (const pkg of added) {
          deps.log(
            `[plugins] module ${pkg}: listed again for ${projectId}, it provides a system app`,
          );
        }
      } catch (err) {
        deps.log(
          `[plugins] ${projectId}: the modules behind system apps were not listed, the next boot tries again: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    deps.log(
      `[plugins] the modules behind system apps were not listed, the next boot tries again: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
