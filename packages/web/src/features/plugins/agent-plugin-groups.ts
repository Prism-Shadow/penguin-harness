/**
 * One Agent's installed parts, sorted by the plugin each came from: what the Agent settings'
 * Plugins tab lists (a pure decision, unit tested).
 *
 * Which plugin a part belongs to is read from what is already on disk, never from an install
 * record of its own:
 *
 * - a Skill belongs to the library plugin that contributes a Skill of that name (the rule the
 *   Plugins page reads "installed" by), so a Skill the user wrote under such a name counts as the
 *   plugin's too;
 * - an MCP server entry to the plugin its `plugin` field names;
 * - a workbench to the plugin its install receipt names;
 * - a hook package to the plugin of its directory's name — when the library has that plugin, or
 *   another part records it. A hook package whose name nothing else knows is indistinguishable
 *   from one the user imported, and is the user's.
 *
 * A plugin an admin removed from the library keeps the parts its records name (hooks, MCP
 * servers, workbenches) and reads "not in library"; its Skills cannot be told apart from the
 * user's and are the user's. What belongs to no plugin is the user's own: their Skills, hook
 * packages and workbenches (their own MCP servers live in the Tools tab, not here).
 *
 * A plugin's status follows the Plugins page: behind when the server lists the Agent as behind on
 * it (`AgentSummary.pluginUpdates` — the page never compares versions), complete when the Agent
 * carries every part the library ships (plugin-status.ts `pluginComplete`), incomplete otherwise.
 */
import type {
  AgentMcpServerItem,
  AgentPluginsInstallResponse,
  HookItem,
  PluginItem,
  PluginUpdateRef,
  SkillMetadataItem,
  WorkbenchInfo,
} from "@prismshadow/penguin-server/api";
import { installsOf } from "./agent-installs";
import { pluginComplete } from "./plugin-status";

/** What a plugin on the Agent is, beside the list: whole, behind the library, partial, or gone from it. */
export type AgentPluginStatus = "installed" | "update" | "incomplete" | "not-in-library";

/** Parts of one kind or another on the Agent. */
export interface AgentParts {
  skills: SkillMetadataItem[];
  hooks: HookItem[];
  mcpServers: AgentMcpServerItem[];
  workbenches: WorkbenchInfo[];
}

/** One plugin the Agent carries something of. */
export interface AgentPluginGroup {
  name: string;
  /** The library's entry; null once an admin removed the plugin from the library. */
  plugin: PluginItem | null;
  parts: AgentParts;
  status: AgentPluginStatus;
}

export interface AgentPluginGroups {
  /** Library plugins in library order, then the ones gone from it, by name. */
  groups: AgentPluginGroup[];
  /** What belongs to no plugin. */
  own: AgentParts;
}

const noParts = (): AgentParts => ({ skills: [], hooks: [], mcpServers: [], workbenches: [] });

/** Whether a group of parts holds anything at all. */
export function hasParts(parts: AgentParts): boolean {
  return (
    parts.skills.length + parts.hooks.length + parts.mcpServers.length + parts.workbenches.length >
    0
  );
}

/**
 * The Agent's parts by plugin. `installed` is the Agent's plugin lists (its install receipts name
 * each workbench's plugin), `workbenches` its workbenches as the workbench list describes them,
 * `library` the plugins of the server the Agent lives on, `updates` what that server lists the
 * Agent as behind on.
 */
export function agentPluginGroups(
  library: readonly PluginItem[],
  installed: AgentPluginsInstallResponse,
  workbenches: readonly WorkbenchInfo[],
  updates: readonly PluginUpdateRef[],
): AgentPluginGroups {
  const byName = new Map<string, PluginItem>();
  for (const plugin of library) if (!byName.has(plugin.name)) byName.set(plugin.name, plugin);
  /** The first library plugin to contribute each Skill name. */
  const skillOwner = new Map<string, string>();
  for (const plugin of byName.values()) {
    for (const skill of plugin.skills) {
      if (!skillOwner.has(skill.name)) skillOwner.set(skill.name, plugin.name);
    }
  }
  const receipts = new Map((installed.workbenches ?? []).map((w) => [w.name, w.plugin]));

  const parts = new Map<string, AgentParts>();
  const own = noParts();
  const into = (owner: string | undefined): AgentParts => {
    if (owner === undefined) return own;
    let group = parts.get(owner);
    if (group === undefined) {
      group = noParts();
      parts.set(owner, group);
    }
    return group;
  };

  for (const skill of installed.skills) into(skillOwner.get(skill.name)).skills.push(skill);
  for (const server of installed.mcpServers) {
    // The user's own servers are the Tools tab's alone.
    if (server.plugin !== undefined) into(server.plugin).mcpServers.push(server);
  }
  for (const workbench of workbenches) into(receipts.get(workbench.id)).workbenches.push(workbench);
  // Last: a hook package joins a plugin the records above already named.
  for (const hook of installed.hooks) {
    const known = byName.has(hook.name) || parts.has(hook.name);
    into(known ? hook.name : undefined).hooks.push(hook);
  }

  const behind = new Set(updates.map((u) => u.name));
  const installs = installsOf(installed);
  const statusOf = (name: string, plugin: PluginItem | null): AgentPluginStatus => {
    if (plugin === null) return "not-in-library";
    if (behind.has(name)) return "update";
    return pluginComplete(plugin, installs) ? "installed" : "incomplete";
  };
  const group = (name: string): AgentPluginGroup => {
    const plugin = byName.get(name) ?? null;
    return { name, plugin, parts: parts.get(name)!, status: statusOf(name, plugin) };
  };
  const inLibrary = [...byName.keys()].filter((name) => parts.has(name));
  const gone = [...parts.keys()].filter((name) => !byName.has(name)).sort();
  return { groups: [...inLibrary, ...gone].map(group), own };
}
