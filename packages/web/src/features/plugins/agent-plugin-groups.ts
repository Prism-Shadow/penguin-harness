/**
 * One Agent's plugins and its installed parts, sorted by the plugin each came from: what the
 * Agent settings' Plugins tab lists — the plugins on its Plugins sub-page, and which plugin a row
 * of its Skills, Hooks and Workbenches sub-pages came from (a pure decision, unit tested).
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
 * carries every part the library ships (plugin-status.ts `pluginComplete`), incomplete otherwise —
 * and then it names the parts it lacks. A library plugin the Agent carries nothing of is
 * available, when it ships anything an Agent can carry at all (`agentInstallable`): a package of
 * server modules alone is no plugin of an Agent's.
 */
import type {
  AgentMcpServerItem,
  AgentPluginsInstallResponse,
  HookItem,
  PluginGroupItem,
  PluginItem,
  PluginUpdateRef,
  SkillMetadataItem,
  WorkbenchInfo,
} from "@prismshadow/penguin-server/api";
import { installsOf } from "./agent-installs";
import { agentInstallable, pluginComplete, type AgentInstalls } from "./plugin-status";

/**
 * What a plugin is to the Agent: whole, behind the library, partial, gone from it — or not on the
 * Agent at all, and installable.
 */
export type AgentPluginStatus =
  "installed" | "update" | "incomplete" | "not-in-library" | "available";

/** Parts of one kind or another on the Agent. */
export interface AgentParts {
  skills: SkillMetadataItem[];
  hooks: HookItem[];
  mcpServers: AgentMcpServerItem[];
  workbenches: WorkbenchInfo[];
}

/** What a library plugin ships and the Agent lacks, by name. */
export interface MissingParts {
  skills: string[];
  /** The plugin ships hooks and the Agent has no hook package of its name. */
  hooks: boolean;
  mcpServers: string[];
  workbenches: string[];
}

/** One plugin, as the Agent carries it (or could). */
export interface AgentPluginGroup {
  name: string;
  /** The library's entry; null once an admin removed the plugin from the library. */
  plugin: PluginItem | null;
  /** The library category the plugin is listed under; null once it left the library. */
  category: string | null;
  /** What the Agent carries of it; empty for an available plugin. */
  parts: AgentParts;
  /** What the library ships and the Agent lacks; all empty unless the plugin is incomplete. */
  missing: MissingParts;
  status: AgentPluginStatus;
}

export interface AgentPluginGroups {
  /** Plugins the Agent carries a part of, by name. */
  groups: AgentPluginGroup[];
  /** Library plugins the Agent carries nothing of and could install, by name; status "available". */
  available: AgentPluginGroup[];
  /** What belongs to no plugin. */
  own: AgentParts;
}

const noParts = (): AgentParts => ({ skills: [], hooks: [], mcpServers: [], workbenches: [] });
const nothingMissing = (): MissingParts => ({
  skills: [],
  hooks: false,
  mcpServers: [],
  workbenches: [],
});

/** Whether a group of parts holds anything at all. */
export function hasParts(parts: AgentParts): boolean {
  return (
    parts.skills.length + parts.hooks.length + parts.mcpServers.length + parts.workbenches.length >
    0
  );
}

/** What of the library plugin the Agent does not carry, by the rules `pluginComplete` reads. */
function missingParts(plugin: PluginItem, installs: AgentInstalls): MissingParts {
  return {
    skills: plugin.skills.map((s) => s.name).filter((name) => !installs.skills.has(name)),
    hooks: plugin.hooks.length > 0 && !installs.hooks.has(plugin.name),
    mcpServers: plugin.mcpServers
      .map((m) => m.name)
      .filter((name) => installs.mcp.get(name)?.plugin !== plugin.name),
    workbenches: (plugin.workbenches ?? [])
      .map((w) => w.name)
      .filter((name) => installs.workbenches?.get(name)?.plugin !== plugin.name),
  };
}

/** Name order, as the Plugins page sorts its cards. */
const byName = (a: AgentPluginGroup, b: AgentPluginGroup) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * The Agent's plugins and its parts by plugin. `library` is the plugin library of the server the
 * Agent lives on, by category; `installed` the Agent's plugin lists (its install receipts name
 * each workbench's plugin), `workbenches` its workbenches as the workbench list describes them,
 * `updates` what that server lists the Agent as behind on.
 */
export function agentPluginGroups(
  library: readonly PluginGroupItem[],
  installed: AgentPluginsInstallResponse,
  workbenches: readonly WorkbenchInfo[],
  updates: readonly PluginUpdateRef[],
): AgentPluginGroups {
  /** Each plugin once, under the first category that lists it. */
  const entries = new Map<string, { plugin: PluginItem; category: string }>();
  for (const group of library) {
    for (const plugin of group.plugins) {
      if (!entries.has(plugin.name)) entries.set(plugin.name, { plugin, category: group.id });
    }
  }
  /** The first library plugin to contribute each Skill name. */
  const skillOwner = new Map<string, string>();
  for (const { plugin } of entries.values()) {
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
    const known = entries.has(hook.name) || parts.has(hook.name);
    into(known ? hook.name : undefined).hooks.push(hook);
  }

  const behind = new Set(updates.map((u) => u.name));
  const installs = installsOf(installed);
  const carried = (name: string): AgentPluginGroup => {
    const entry = entries.get(name);
    const group = { name, parts: parts.get(name)!, missing: nothingMissing() };
    if (entry === undefined) {
      return { ...group, plugin: null, category: null, status: "not-in-library" };
    }
    const { plugin, category } = entry;
    if (behind.has(name)) return { ...group, plugin, category, status: "update" };
    if (pluginComplete(plugin, installs))
      return { ...group, plugin, category, status: "installed" };
    return {
      ...group,
      plugin,
      category,
      missing: missingParts(plugin, installs),
      status: "incomplete",
    };
  };
  const available = [...entries.values()]
    .filter(({ plugin }) => !parts.has(plugin.name) && agentInstallable(plugin))
    .map(({ plugin, category }): AgentPluginGroup => ({
      name: plugin.name,
      plugin,
      category,
      parts: noParts(),
      missing: nothingMissing(),
      status: "available",
    }));
  return {
    groups: [...parts.keys()].map(carried).sort(byName),
    available: available.sort(byName),
    own,
  };
}
