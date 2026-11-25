/**
 * The one-time listing of preinstalled built-in modules into the Projects created before their
 * build shipped them (PRFC-0030). Creation lists a preinstalled module in every Project made
 * since (PluginModules.preinstall); this lists it once in the ones that came before, so an
 * upgrade does not take the feature away from them.
 *
 * WHEN. Every boot of a generation, after the database migrations and before the plugin closure
 * is read (hmr/platform.ts). That generation therefore loads the module with no re-assembly of
 * its own, however many Projects there are.
 *
 * WHAT. The record (plugin_module_preinstalls) holds, per package, the Projects already handled.
 * For every other Project, this server's own `[plugins.<machineId>]` table gains each
 * preinstalled module it does not list yet — nothing else of the file changes — and the pair is
 * recorded. From then on the Project's table is the administrator's: a removal is never undone
 * by a later boot — except a module behind a system app's, which every boot lists again
 * (system-app-relist.ts). A Project created while the module was preinstalled was recorded at its
 * creation; so the ones this still finds are those an older build made, a generation without
 * this code made during a push included, and the ones a failure left unrecorded.
 *   - A module the administrator stopped (its ledger row says declined) is recorded without
 *     being listed.
 *   - A Project whose config will not parse is recorded and passed over for good, with a log
 *     line: the administrator lists the module there by hand once the file is fixed.
 *   - A Project whose config cannot be read or written (permissions, a file held open, a full
 *     disk) is not recorded, with a log line naming the cause: the next boot tries again, which
 *     changes nothing where the listing already took.
 *   - Every Project changed is a log line.
 * The ledger (plugin_module_requests) gains a row for each preinstalled module nobody asked
 * for — enabled, built in, by no one — so the administrator sees it and can stop it; a row
 * waiting for a decision is decided the same way, since the module runs.
 *
 * SAFE TO REPEAT. A pair is recorded after its table is written, and a listing already in place
 * is skipped. Two generations booting at once (a push crossing a re-assembly) write the same
 * entry, and a process that stops in between does it again on its next boot.
 *
 * BACKWARD COMPATIBILITY. This is the migration of stored config for Projects created before
 * their build preinstalled a module. It stays until the next major version (1.0); whoever
 * prepares 1.0 removes this file, its call in hmr/platform.ts and the plugin_module_preinstalls
 * table with its repo (and a migration that drops it), and decides whether a module preinstalled
 * after 1.0 should still reach existing Projects (PRFC-0030's open question). See
 * changelog/0.2.19/2026-11-19-backward-compatibility.md.
 */
import type {
  PluginModulePreinstalls,
  PluginModuleRequests,
} from "@prismshadow/penguin-library-setting";
import { listProjectIds, type PluginBase } from "../plugin/loader.js";
import { preinstalledModules, type PreinstalledModule } from "../plugin/preinstall.js";
import { listInOwnTable, UnparseableConfig } from "./own-table-listing.js";

export interface PreinstallOnceDeps {
  preinstalls: PluginModulePreinstalls;
  ledger: PluginModuleRequests;
  root: string;
  /** The plugin bases of the generation booting (its own assets, not the committed ones). */
  bases: readonly PluginBase[];
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  now: () => string;
  log: (line: string) => void;
}

/** Lists each preinstalled module in every Project not handled for it yet. Never throws. */
export async function listPreinstalledOnce(deps: PreinstallOnceDeps): Promise<void> {
  try {
    const modules = await preinstalledModules(deps.bases, true);
    if (modules.length === 0) return;
    const at = deps.now();
    for (const module of modules) seedLedger(deps.ledger, module, at);
    const handled = new Map(
      modules.map((m) => [m.package, new Set(deps.preinstalls.projectsOf(m.package))]),
    );
    const declined = new Set(
      modules
        .filter((m) => deps.ledger.get(m.package)?.decision === "declined")
        .map((m) => m.package),
    );
    for (const projectId of await listProjectIds(deps.root)) {
      const pending = modules
        .map((m) => m.package)
        .filter((pkg) => !handled.get(pkg)!.has(projectId));
      if (pending.length === 0) continue;
      try {
        const added = await listInOwnTable(
          deps.root,
          projectId,
          deps.machineId,
          pending.filter((pkg) => !declined.has(pkg)),
        );
        for (const pkg of added) {
          deps.log(
            `[plugins] module ${pkg}: listed for ${projectId} (preinstalled, once for a Project created before it)`,
          );
        }
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        if (!(err instanceof UnparseableConfig)) {
          deps.log(
            `[plugins] ${projectId}: the preinstalled modules were not listed, the next boot tries again: ${cause}`,
          );
          continue;
        }
        deps.log(
          `[plugins] ${projectId}: the preinstalled modules were not listed, its config is not valid TOML (${cause}); list them on the Plugins page once it is fixed`,
        );
      }
      for (const pkg of pending) deps.preinstalls.record(pkg, [projectId], deps.now());
    }
  } catch (err) {
    deps.log(
      `[plugins] the preinstalled modules were not listed in the existing Projects, the next boot tries again: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * The ledger row of a preinstalled module: written when nobody ever asked for the package —
 * enabled, built in, by no one, for no Project — and a row waiting for a decision is decided so;
 * a row an administrator decided stays as it is.
 */
function seedLedger(ledger: PluginModuleRequests, module: PreinstalledModule, at: string): void {
  const row = ledger.get(module.package);
  if (row === null) {
    ledger.upsert({
      package: module.package,
      plugin: module.plugin,
      projectId: null,
      agentId: null,
      requestedBy: "",
      requestedAt: at,
      decision: "enabled",
      decidedBy: "",
      decidedAt: at,
      via: "builtin",
    });
  } else if (row.decision === null) {
    ledger.decide(module.package, "enabled", "", at, "builtin");
  }
}
