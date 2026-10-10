/**
 * A plugin's install status on the Plugins page, and the per-Agent facts it is read from (pure
 * decisions, unit tested).
 *
 * A plugin of Skills and hooks is installed on Agents; a server-module plugin is installed on
 * the server. So the two read their status from different places:
 *
 * - Skills / hooks / MCP servers: `update` when the server lists some Agent as behind on it
 *   (`AgentSummary.pluginUpdates` — the web never compares versions itself), `installed` when at
 *   least one Agent of the Project has it, `available` otherwise. An Agent has it when it carries
 *   every part (each Skill, the hook package when there is one, and each MCP server as an entry
 *   the plugin installed), or when the server lists its copy as behind — a copy an update
 *   completes is a copy all the same. A server waiting for a vault value or a sign-in is still
 *   installed: what it waits for is shown beside the Agent, never as "not installed".
 * - A server module: `installed` when the Project lists it and this server runs it, `restart`
 *   when it waits for a restart, `failed` when this server could not load it, `not-here` when it
 *   runs on other machines only (or the machine in view has not reported it yet), `available`
 *   when the Project does not list it. A plugin that is both follows the module — where it runs —
 *   and still counts the Agents that use its Skills.
 */
import type {
  AgentMcpServerItem,
  AgentSummary,
  PluginItem,
  PluginMcpServerItem,
} from "@prismshadow/penguin-server/api";

/**
 * What one Agent has installed, the three lists a plugin is spread over: its skills and its
 * hook packages by name → the installed copy's dated version (`YYYY.MM.DD.N`, or "" when the
 * files carry none), and its MCP servers by name → the entry (which plugin installed it, if
 * any, and what keeps it from connecting).
 */
export interface AgentInstalls {
  skills: ReadonlyMap<string, string>;
  hooks: ReadonlyMap<string, string>;
  mcp: ReadonlyMap<string, AgentMcpServerItem>;
}

/** agentId → what is installed there; the page's snapshot, rewritten in place by optimistic updates. */
export type InstalledMap = ReadonlyMap<string, AgentInstalls>;

/** The fields of a plugin the install questions read (the page passes the whole item; tests can pass just these). */
export type PluginParts = Pick<PluginItem, "name" | "skills" | "hooks" | "mcpServers">;

/** The six statuses, in the order a status grouping lists them: what wants a look first. */
export const PLUGIN_STATUSES = [
  "update",
  "installed",
  "restart",
  "failed",
  "not-here",
  "available",
] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/**
 * What a listed module plugin is on the machine in view: running; waiting for a runtime that
 * can re-assemble (`pending`); FAILED — the process tried and could not load it, for the reason
 * the server sends, which no restart would change; `elsewhere` — the all-machines view of a
 * plugin listed only for other machines, which this server neither installs nor loads;
 * `unsynced` — listed for a machine that has not reported running it; `none` — not listed.
 */
export type ModuleState = "none" | "pending" | "active" | "failed" | "elsewhere" | "unsynced";

/** The Agent's entry of one of the plugin's MCP servers: one by that name the plugin installed — a server the user added under the same name is not the plugin's. */
function pluginServer(
  plugin: Pick<PluginItem, "name">,
  installs: AgentInstalls,
  server: string,
): AgentMcpServerItem | undefined {
  const entry = installs.mcp.get(server);
  return entry?.plugin === plugin.name ? entry : undefined;
}

/** Whether an Agent carries any part of the plugin: one of its skills, its hook package (named after the plugin), or one of its MCP servers. */
export function pluginPresent(plugin: PluginParts, installs: AgentInstalls | undefined): boolean {
  if (installs === undefined) return false;
  return (
    plugin.skills.some((skill) => installs.skills.has(skill.name)) ||
    (plugin.hooks.length > 0 && installs.hooks.has(plugin.name)) ||
    plugin.mcpServers.some((server) => pluginServer(plugin, installs, server.name) !== undefined)
  );
}

/** Whether an Agent carries every part of the plugin — each skill, the hook package when it ships one, each MCP server. A plugin that ships nothing is on no Agent. */
export function pluginComplete(plugin: PluginParts, installs: AgentInstalls | undefined): boolean {
  if (installs === undefined) return false;
  const parts = plugin.skills.length + (plugin.hooks.length > 0 ? 1 : 0) + plugin.mcpServers.length;
  return (
    parts > 0 &&
    plugin.skills.every((skill) => installs.skills.has(skill.name)) &&
    (plugin.hooks.length === 0 || installs.hooks.has(plugin.name)) &&
    plugin.mcpServers.every((server) => pluginServer(plugin, installs, server.name) !== undefined)
  );
}

/**
 * What keeps the plugin's MCP servers on one Agent from their tools: the vault keys they miss
 * (once each, in the plugin's order) and whether one needs a sign-in. Null when the Agent
 * carries none of them.
 */
export function pluginMcpState(
  plugin: PluginParts,
  installs: AgentInstalls | undefined,
): { missingKeys: string[]; signIn: boolean } | null {
  if (installs === undefined) return null;
  const carried = plugin.mcpServers
    .map((server) => pluginServer(plugin, installs, server.name))
    .filter((entry): entry is AgentMcpServerItem => entry !== undefined);
  if (carried.length === 0) return null;
  return {
    missingKeys: [...new Set(carried.flatMap((entry) => entry.missingKeys))],
    signIn: carried.some((entry) => entry.signIn),
  };
}

/** The plugin's stdio servers: commands this server runs whenever a session of an Agent that has them starts. */
export function stdioServers(plugin: Pick<PluginItem, "mcpServers">): PluginMcpServerItem[] {
  return plugin.mcpServers.filter((server) => server.transport === "stdio");
}

/**
 * Whether installing the plugin on an Agent asks first: it brings a stdio server the Agent does
 * not carry yet. Whoever installs — any member — confirms once per Agent, having seen the
 * command; a reinstall of what is already there does not ask again.
 */
export function installNeedsConfirm(
  plugin: PluginParts,
  installs: AgentInstalls | undefined,
): boolean {
  return stdioServers(plugin).some(
    (server) => installs === undefined || pluginServer(plugin, installs, server.name) === undefined,
  );
}

/** Which Agents of the Project use a plugin, and which of those the server lists as behind on it. */
export interface LibraryUsage {
  /** Agents that have the plugin: every part, or a copy listed as behind. */
  usedBy: string[];
  /** Agents the server lists as behind on it that still carry some of it. */
  behind: string[];
}

/**
 * The Agents a plugin is on, in list order. Behind comes from the server's verdict, filtered to
 * the Agents this page's snapshot still shows a part on — the list is re-read after every install
 * action, but the snapshot moves first, so an Agent just uninstalled must not keep its update.
 */
export function libraryUsage(
  plugin: PluginParts,
  agents: ReadonlyArray<Pick<AgentSummary, "agentId" | "pluginUpdates">>,
  installed: InstalledMap,
): LibraryUsage {
  const behind = agents
    .filter(
      (agent) =>
        agent.pluginUpdates.some((update) => update.name === plugin.name) &&
        pluginPresent(plugin, installed.get(agent.agentId)),
    )
    .map((agent) => agent.agentId);
  const usedBy = agents
    .filter(
      (agent) =>
        behind.includes(agent.agentId) || pluginComplete(plugin, installed.get(agent.agentId)),
    )
    .map((agent) => agent.agentId);
  return { usedBy, behind };
}

/** A server module's status, from its state on the machine in view. */
export function moduleStatus(state: ModuleState): PluginStatus {
  switch (state) {
    case "active":
      return "installed";
    case "pending":
      return "restart";
    case "failed":
      return "failed";
    case "elsewhere":
    case "unsynced":
      return "not-here";
    case "none":
      return "available";
  }
}

/** A plugin's status: the module's where it is one, its Agents' otherwise. */
export function pluginStatus(
  row: { module?: { state: ModuleState } },
  usage: LibraryUsage | null,
): PluginStatus {
  if (row.module !== undefined) return moduleStatus(row.module.state);
  if (usage === null) return "available";
  if (usage.behind.length > 0) return "update";
  return usage.usedBy.length > 0 ? "installed" : "available";
}

/**
 * The parts an update rewrites with something else, for one Agent: every part whose installed
 * version differs from the library's — older, or newer where the Agent edited it locally and
 * raised its own version (the reinstall overwrites both) — and every MCP server of the plugin
 * the Agent carries, which the reinstall replaces whole (an entry carries no version to
 * compare). A part the Agent does not carry is not listed: the update adds it, and there is no
 * "old" to show. Only displayed — "differs" is all it asks, never which is newer.
 */
export function changedParts(
  plugin: PluginParts & Pick<PluginItem, "hookVersion">,
  installs: AgentInstalls | undefined,
): ChangedPart[] {
  if (installs === undefined) return [];
  const parts: ChangedPart[] = [];
  for (const skill of plugin.skills) {
    const installed = installs.skills.get(skill.name);
    if (installed !== undefined && installed !== skill.version) {
      parts.push({ kind: "skill", name: skill.name, installed, library: skill.version });
    }
  }
  const hooks = installs.hooks.get(plugin.name);
  if (plugin.hookVersion !== undefined && hooks !== undefined && hooks !== plugin.hookVersion) {
    parts.push({ kind: "hooks", name: plugin.name, installed: hooks, library: plugin.hookVersion });
  }
  for (const server of plugin.mcpServers) {
    if (pluginServer(plugin, installs, server.name) !== undefined) {
      parts.push({ kind: "mcp", name: server.name, installed: "", library: "" });
    }
  }
  return parts;
}

/** One part an update rewrites: a skill by name, the plugin's hook package, or one of its MCP servers (no versions: replaced whole). */
export interface ChangedPart {
  kind: "skill" | "hooks" | "mcp";
  name: string;
  installed: string;
  library: string;
}
