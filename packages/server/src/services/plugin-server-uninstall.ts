/**
 * Uninstalling a plugin from THIS server, which uninstalls it from every Agent here first (05
 * 「插件库」 「安装模型」, 2026-11-20): an Agent's copy of a plugin comes from the package on its
 * server, so a package that leaves the server takes every copy with it.
 *
 * In order, so nothing is left half-way that the next read would misreport:
 *
 * 1. Refused before anything changes — a package the build ships (it is not this server's to
 *    remove: 409 `plugin_shipped`), one not in this server's prefix (404 `plugin_not_installed`),
 *    and one a Project's SHARED table lists (409 `plugin_shared`, naming those Projects: that
 *    table travels to every machine of the Project and is edited in the Project's config, not
 *    here).
 * 2. Every Agent of every Project here that carries any part of it loses it, as the Agent's own
 *    uninstall removes it (services/plugin-uninstall.ts) — workbenches with their data and history,
 *    locally edited Skills and hooks included. This runs while the package is still on disk: a
 *    Skill is known to be the plugin's by the library's list of its Skills. A part that fails is
 *    reported and the others still go.
 * 3. It leaves this server's own table (`[plugins.<machineId>]`) of every Project, in one change:
 *    re-assembled when that changes what this server runs, undone when the new tree fails to boot.
 * 4. npm uninstalls it from the prefix.
 *
 * `holders` answers who would lose it, for the confirm, without changing anything.
 */
import fs from "node:fs/promises";
import { agentsDir, systemConfigPath, type PluginTables } from "@prismshadow/penguin-core";
import type {
  PluginHolder,
  PluginHoldersResponse,
  PluginServerUninstallResponse,
} from "../api/types.js";
import type { ReassemblyChange } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import {
  linkedPackages,
  PluginInstallError,
  pluginsPrefix,
  readInstalledVersion,
} from "../plugin/install.js";
import type { PluginLibrary } from "../plugin/library-module.js";
import { discoverBuiltinPlugins, listProjectIds, type PluginBase } from "../plugin/loader.js";
import { pluginPartsOn, uninstallAgentPlugin } from "./plugin-uninstall.js";
import type { PluginUninstallDeps } from "./plugin-uninstall.js";

export interface PluginServerUninstallDeps {
  root: string;
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  bases: () => readonly PluginBase[];
  library: Pick<PluginLibrary, "get" | "list">;
  workbenches: PluginUninstallDeps["workbenches"];
  projectConfig: {
    getPluginTables(projectId: string): Promise<PluginTables>;
    setPluginTables(projectId: string, tables: PluginTables): Promise<void>;
    getName(projectId: string): Promise<string | undefined>;
  };
  /** The Agent's display name, when its config carries one. */
  agentName: (projectId: string, agentId: string) => Promise<string | undefined>;
  /** Writes the change and re-assembles the App on it; false when the new tree did not boot. */
  apply: (change: ReassemblyChange) => Promise<boolean>;
  /** The closure of what this server runs (every Project's tables for it). */
  closure: () => Promise<readonly string[]>;
  removePackage: (name: string) => Promise<void>;
  /** A running conversation of the Agent is rebuilt without the plugin on its next idle access. */
  invalidate: (projectId: string, agentId: string) => void;
  log: (line: string) => void;
}

/** Every Agent directory of a Project: a folder holding system_config.yaml, as the routes count one. */
async function agentIdsOf(root: string, projectId: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await fs.readdir(agentsDir(root, projectId), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const agentId of names.sort()) {
    try {
      await fs.access(systemConfigPath(root, projectId, agentId));
      out.push(agentId);
    } catch {
      // A folder without system_config.yaml is not an Agent.
    }
  }
  return out;
}

export class PluginServerUninstall {
  constructor(private readonly deps: PluginServerUninstallDeps) {}

  /** The library plugin a package is, by name; null for a server module alone. */
  private pluginOf(pkg: string): string | null {
    try {
      return this.deps.library.list().find((p) => p.packageName === pkg)?.name ?? null;
    } catch {
      return null;
    }
  }

  /** Whether the package is in this server's prefix, installed or linked. */
  private async onServer(pkg: string): Promise<boolean> {
    const prefix = pluginsPrefix(this.deps.root);
    if ((await readInstalledVersion(prefix, pkg)) !== null) return true;
    return (await linkedPackages(prefix)).has(pkg);
  }

  /** Whether the build ships it: a server module of a builtin prefix, or a library plugin built in. */
  private async shipped(pkg: string, plugin: string | null): Promise<boolean> {
    if ((await discoverBuiltinPlugins(this.deps.bases())).includes(pkg)) return true;
    if (plugin === null) return false;
    try {
      const found = this.deps.library.get(plugin);
      return found !== undefined && found.source !== "installed";
    } catch {
      return false;
    }
  }

  /** The Projects whose shared table lists the package. */
  private async sharedBy(pkg: string): Promise<Array<{ projectId: string; projectName: string }>> {
    const out: Array<{ projectId: string; projectName: string }> = [];
    for (const projectId of await listProjectIds(this.deps.root)) {
      const tables = await this.deps.projectConfig.getPluginTables(projectId).catch(() => null);
      if (tables !== null && pkg in tables.all) {
        out.push({ projectId, projectName: await this.projectName(projectId) });
      }
    }
    return out;
  }

  private async projectName(projectId: string): Promise<string> {
    return (await this.deps.projectConfig.getName(projectId).catch(() => undefined)) ?? projectId;
  }

  /** Every Agent here carrying any part of library plugin `plugin`, all Projects. */
  private async holdersOf(plugin: string): Promise<PluginHolder[]> {
    const out: PluginHolder[] = [];
    for (const projectId of await listProjectIds(this.deps.root)) {
      const projectName = await this.projectName(projectId);
      for (const agentId of await agentIdsOf(this.deps.root, projectId)) {
        const parts = await pluginPartsOn(this.deps, projectId, agentId, plugin).catch(() => null);
        if (parts === null) continue;
        const holds =
          parts.workbenches.length + parts.mcpServers.length + parts.skills.length > 0 ||
          parts.hook;
        if (!holds) continue;
        const agentName =
          (await this.deps.agentName(projectId, agentId).catch(() => undefined)) ?? agentId;
        out.push({ projectId, projectName, agentId, agentName });
      }
    }
    return out;
  }

  /** Who would lose the plugin, and whether the uninstall can run at all. */
  async holders(pkg: string): Promise<PluginHoldersResponse> {
    const plugin = this.pluginOf(pkg);
    const [onServer, shipped, shared] = await Promise.all([
      this.onServer(pkg),
      this.shipped(pkg, plugin),
      this.sharedBy(pkg),
    ]);
    return {
      package: pkg,
      plugin,
      onServer,
      shipped,
      shared,
      agents: plugin === null || !onServer ? [] : await this.holdersOf(plugin),
    };
  }

  /** Runs the uninstall (see the header). */
  async uninstall(pkg: string, actor: string): Promise<PluginServerUninstallResponse> {
    const plugin = this.pluginOf(pkg);
    if (!(await this.onServer(pkg))) {
      if (await this.shipped(pkg, plugin)) {
        throw new HttpError(
          409,
          "plugin_shipped",
          `${pkg} ships with this server's build: it cannot be uninstalled from the server.`,
        );
      }
      throw new HttpError(404, "plugin_not_installed", `${pkg} is not installed on this server.`);
    }
    const shared = await this.sharedBy(pkg);
    if (shared.length > 0) {
      throw new HttpError(
        409,
        "plugin_shared",
        `${pkg} is listed for every machine in the plugin table of ${shared.map((p) => p.projectName).join(", ")}: remove it there first.`,
      );
    }
    // 2. Every Agent's copy, while the library still knows the plugin's Skills.
    const agents: PluginServerUninstallResponse["agents"] = [];
    if (plugin !== null) {
      for (const holder of await this.holdersOf(plugin)) {
        const result = await uninstallAgentPlugin(
          this.deps,
          holder.projectId,
          holder.agentId,
          plugin,
        ).catch((err: unknown) => ({
          removed: { skills: [], hooks: [], mcpServers: [], workbenches: [] },
          failed: [
            {
              kind: "skill" as const,
              name: plugin,
              error: err instanceof Error ? err.message : String(err),
            },
          ],
        }));
        this.deps.invalidate(holder.projectId, holder.agentId);
        agents.push({
          ...holder,
          ...(result?.failed !== undefined ? { failed: result.failed } : {}),
        });
      }
    }
    // 3. Out of this server's own table of every Project, in one change.
    await this.unlistHere(pkg);
    // 4. The package itself.
    try {
      await this.deps.removePackage(pkg);
    } catch (err) {
      if (err instanceof PluginInstallError) {
        // npm's own failures carry the bucket its stderr fell in; a removal made without npm, or
        // any other error (no npm here, the prefix unreadable), is not worded as npm's.
        const fromNpm =
          err.withoutNpm !== true && err.reason !== undefined && err.reason !== "missing";
        throw new HttpError(
          500,
          "plugin_remove_failed",
          fromNpm ? `npm: ${err.message}` : err.message,
        );
      }
      throw err;
    }
    this.deps.log(
      `[plugins] ${pkg} uninstalled from the server by ${actor}, and from ${agents.length} Agent(s)`,
    );
    return { package: pkg, plugin, agents };
  }

  private async unlistHere(pkg: string): Promise<void> {
    const own: string[] = [];
    for (const projectId of await listProjectIds(this.deps.root)) {
      const tables = await this.deps.projectConfig.getPluginTables(projectId).catch(() => null);
      if (tables !== null && pkg in (tables.machines[this.deps.machineId] ?? {})) {
        own.push(projectId);
      }
    }
    if (own.length === 0) return;
    const previous = new Map<string, PluginTables>();
    const write = async () => {
      for (const projectId of own) {
        const tables = await this.deps.projectConfig.getPluginTables(projectId);
        previous.set(projectId, tables);
        const kept = { ...tables.machines[this.deps.machineId] };
        delete kept[pkg];
        await this.deps.projectConfig.setPluginTables(projectId, {
          ...tables,
          machines: { ...tables.machines, [this.deps.machineId]: kept },
        });
      }
    };
    if (!(await this.deps.closure()).includes(pkg)) {
      await write();
      return;
    }
    const took = await this.deps.apply({
      write,
      undo: async () => {
        for (const [projectId, tables] of previous) {
          await this.deps.projectConfig.setPluginTables(projectId, tables);
        }
      },
    });
    if (!took && (await this.deps.closure()).includes(pkg)) {
      throw new HttpError(
        409,
        "module_failed",
        "The server could not start without this plugin's module, so its listing was restored and the package kept.",
      );
    }
  }
}
