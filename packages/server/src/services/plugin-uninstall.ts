/**
 * Uninstalling one plugin from an Agent, every part it put there, in one request. A part
 * belongs to a plugin by the record each kind already keeps — no install record of its own:
 *
 * - a workbench by its install receipt (`.plugin.json`'s `plugin`);
 * - an MCP server by its `tools.mcpServers` entry's `plugin` field;
 * - the hook package by its folder's name, which is the plugin's;
 * - a Skill by its name being one the library plugin contributes — the rule the Plugins page
 *   reads "installed" by, so a Skill of that name made by hand goes too, and a plugin that has
 *   left the library takes no Skill with it (there is nothing to read the names from).
 *
 * Workbenches go first and through the workbench service, as a single removal does: the
 * instance is let go and the removal is recorded in the Agent State history. The rest is file
 * work in core. A part that fails is reported and the others are still removed; nothing is
 * rolled back. The caller invalidates the Agent's runtimes once, afterwards.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  hooksDir,
  listInstalledMcpServers,
  listInstalledWorkbenches,
  removeHook,
  removeSkill,
  skillsDir,
  uninstallPluginMcpServers,
} from "@prismshadow/penguin-core";
import type { InstalledMcpServer } from "@prismshadow/penguin-core";
import type { PluginUninstallResponse } from "../api/types.js";
import type { Workbenches } from "../mechanisms/workbenches.js";
import type { PluginLibrary } from "../plugin/library-module.js";
import { WorkbenchNotFound } from "../workbenches/service.js";

export interface PluginUninstallDeps {
  root: string;
  library: Pick<PluginLibrary, "get">;
  workbenches: Pick<Workbenches, "remove">;
}

type Failure = NonNullable<PluginUninstallResponse["failed"]>[number];

const exists = (file: string): Promise<boolean> =>
  fs.access(file).then(
    () => true,
    () => false,
  );

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Removes every part of plugin `name` from the Agent (see the file header), in order:
 * workbenches, MCP servers, the hook package, Skills. Null when the Agent has no part of it.
 */
export async function uninstallAgentPlugin(
  deps: PluginUninstallDeps,
  projectId: string,
  agentId: string,
  name: string,
): Promise<PluginUninstallResponse | null> {
  const removed: PluginUninstallResponse["removed"] = {
    skills: [],
    hooks: [],
    mcpServers: [],
    workbenches: [],
  };
  const failed: Failure[] = [];
  /**
   * Runs one part's removal, which answers whether there was anything to remove; a throw is
   * that part's failure, not the request's.
   */
  const attempt = async (
    kind: Failure["kind"],
    parts: readonly string[],
    remove: () => Promise<boolean>,
  ): Promise<boolean> => {
    try {
      return await remove();
    } catch (err) {
      for (const part of parts) failed.push({ kind, name: part, error: messageOf(err) });
      return false;
    }
  };

  const workbenches = (await listInstalledWorkbenches(deps.root, projectId, agentId)).filter(
    (w) => w.plugin === name,
  );
  for (const { name: id } of workbenches) {
    const done = await attempt("workbench", [id], () =>
      deps.workbenches.remove(projectId, agentId, id).then(
        () => true,
        (err: unknown) => {
          // Removed by someone else since the receipts were read: nothing left to do.
          if (err instanceof WorkbenchNotFound) return false;
          throw err;
        },
      ),
    );
    if (done) removed.workbenches.push(id);
  }

  // Named before the write, so a write that fails can say which servers it left.
  const servers = (
    await listInstalledMcpServers(deps.root, projectId, agentId).catch(
      (): InstalledMcpServer[] => [],
    )
  )
    .map((server) => server.entry)
    .filter((entry) => entry.plugin === name)
    .map((entry) => entry.name);
  if (servers.length > 0) {
    await attempt("mcpServer", servers, async () => {
      removed.mcpServers.push(
        ...(await uninstallPluginMcpServers(deps.root, projectId, agentId, name)),
      );
      return true;
    });
  }

  // A hook package is a folder holding hooks.json, as the hooks routes count one.
  if (await exists(path.join(hooksDir(deps.root, projectId, agentId), name, "hooks.json"))) {
    const done = await attempt("hook", [name], async () => {
      await removeHook(deps.root, projectId, agentId, name);
      return true;
    });
    if (done) removed.hooks.push(name);
  }

  const skills = deps.library.get(name)?.skills ?? [];
  for (const { name: skill } of skills) {
    // A Skill is a folder holding SKILL.md, as the listing counts one.
    if (!(await exists(path.join(skillsDir(deps.root, projectId, agentId), skill, "SKILL.md")))) {
      continue;
    }
    const done = await attempt("skill", [skill], async () => {
      await removeSkill(deps.root, projectId, agentId, skill);
      return true;
    });
    if (done) removed.skills.push(skill);
  }

  const touched = Object.values(removed).some((parts) => parts.length > 0) || failed.length > 0;
  if (!touched) return null;
  return failed.length > 0 ? { removed, failed } : { removed };
}
