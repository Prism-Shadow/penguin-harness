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
 * - A plugin that is both, whose module does not run on the server in view, is `awaiting` while a
 *   member's request waits for the administrator and `stopped` once the administrator declined or
 *   stopped it (`moduleRequestStatus`). "pending" is not a word for either: in a module's state it
 *   already means "waiting for a restart".
 *
 * On an Agent's own plugin list, such a plugin's module gets a mark of its own while it does not
 * run there, with the action the viewer can take (`agentModuleMark`).
 */
import type {
  AgentMcpServerItem,
  AgentSummary,
  PluginItem,
  PluginMcpServerItem,
  PluginModuleStatus,
} from "@prismshadow/penguin-server/api";

/**
 * What one Agent has installed, the three lists a plugin is spread over: its skills and its
 * hook packages by name → the installed copy's dated version (`YYYY.MM.DD.N`, or "" when the
 * files carry none), and its MCP servers by name → the entry (which plugin installed it, if
 * any, and what keeps it from connecting).
 */
export interface AgentInstalls {
  skills: ReadonlyMap<string, string>;
  workbenches?: ReadonlyMap<string, { plugin: string; version: string }>;
  hooks: ReadonlyMap<string, string>;
  mcp: ReadonlyMap<string, AgentMcpServerItem>;
}

/** agentId → what is installed there; the page's snapshot, rewritten in place by optimistic updates. */
export type InstalledMap = ReadonlyMap<string, AgentInstalls>;

/** The fields of a plugin the install questions read (the page passes the whole item; tests can pass just these). */
export type PluginParts = Pick<
  PluginItem,
  "name" | "skills" | "hooks" | "mcpServers" | "workbenches"
>;

/** The statuses, in the order a status grouping lists them: what wants a look first. */
export const PLUGIN_STATUSES = [
  "update",
  "installed",
  "awaiting",
  "restart",
  "failed",
  "incompatible",
  "stopped",
  "not-here",
  "available",
] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/**
 * What a listed module plugin is on the machine in view: running; waiting for a runtime that
 * can re-assemble (`pending`); FAILED — the process tried and could not load it, for the reason
 * the server sends, which no restart would change; `disabled` — incompatible with the
 * platform or build on the selected machine;
 * `unsynced` — listed for a machine that has not reported running it; `none` — not listed.
 */
export type ModuleState = "none" | "pending" | "active" | "failed" | "disabled" | "unsynced";

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
    (plugin.workbenches ?? []).some(
      (w) => installs.workbenches?.get(w.name)?.plugin === plugin.name,
    ) ||
    plugin.skills.some((skill) => installs.skills.has(skill.name)) ||
    (plugin.hooks.length > 0 && installs.hooks.has(plugin.name)) ||
    plugin.mcpServers.some((server) => pluginServer(plugin, installs, server.name) !== undefined)
  );
}

/**
 * Whether a library plugin can go on an Agent at all: it ships a Skill, a hook package, an MCP
 * server or a workbench. A package of server modules alone ships nothing an Agent carries.
 */
export function agentInstallable(plugin: PluginParts): boolean {
  return (
    (plugin.workbenches?.length ?? 0) +
      plugin.skills.length +
      (plugin.hooks.length > 0 ? 1 : 0) +
      plugin.mcpServers.length >
    0
  );
}

/** Whether an Agent carries every Skill, hook package, MCP server and workbench in the plugin. A plugin that ships nothing is on no Agent. */
export function pluginComplete(plugin: PluginParts, installs: AgentInstalls | undefined): boolean {
  if (installs === undefined) return false;
  return (
    agentInstallable(plugin) &&
    (plugin.workbenches ?? []).every(
      (w) => installs.workbenches?.get(w.name)?.plugin === plugin.name,
    ) &&
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
  /** Of `usedBy`, the Agents counted as last seen: on a machine that cannot be asked right now. */
  lastSeen?: string[];
}

/** An Agent as the usage reads it; `lastSeen` marks one on a machine out of reach right now. */
export type UsageAgent = Pick<AgentSummary, "agentId" | "pluginUpdates"> & { lastSeen?: boolean };

/**
 * The Agents a plugin is on, in list order. Behind comes from the server's verdict, filtered to
 * the Agents this page's snapshot still shows a part on — the list is re-read after every install
 * action, but the snapshot moves first, so an Agent just uninstalled must not keep its update.
 *
 * Only what the snapshot knows counts: an Agent it holds nothing for (its server has not answered,
 * or could not) is neither using the plugin nor not using it, and is simply not counted. An Agent
 * on a machine out of reach counts with what that machine last answered, and is named in
 * `lastSeen` so the status can say so.
 */
export function libraryUsage(
  plugin: PluginParts,
  agents: ReadonlyArray<UsageAgent>,
  installed: InstalledMap,
): LibraryUsage {
  const targets = [...new Map(agents.map((agent) => [agent.agentId, agent])).values()];
  const behind = targets
    .filter(
      (agent) =>
        agent.pluginUpdates.some((update) => update.name === plugin.name) &&
        pluginPresent(plugin, installed.get(agent.agentId)),
    )
    .map((agent) => agent.agentId);
  const using = targets.filter(
    (agent) =>
      behind.includes(agent.agentId) || pluginComplete(plugin, installed.get(agent.agentId)),
  );
  return {
    usedBy: using.map((agent) => agent.agentId),
    behind,
    lastSeen: using.filter((agent) => agent.lastSeen === true).map((agent) => agent.agentId),
  };
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
    case "disabled":
      return "incompatible";
    case "unsynced":
      return "not-here";
    case "none":
      return "available";
  }
}

/**
 * What stands of an ask to run a plugin's server module, as a status: `awaiting` while a request
 * waits for the administrator, `stopped` once the administrator declined or stopped it — only while
 * the module does not run, since a running module is what its status says. Null otherwise.
 */
export function moduleRequestStatus(
  mod: Pick<PluginModuleStatus, "state" | "request"> | undefined,
): "awaiting" | "stopped" | null {
  if (mod?.state !== "off" || mod.request === undefined) return null;
  return mod.request.status === "pending" ? "awaiting" : "stopped";
}

/**
 * A plugin's status: what stands of an ask for its server module where there is one
 * (`moduleRequestStatus`), else the module's where it is one, its Agents' otherwise.
 */
export function pluginStatus(
  row: { module?: { state: ModuleState } },
  usage: LibraryUsage | null,
  mod?: Pick<PluginModuleStatus, "state" | "request">,
): PluginStatus {
  const asked = moduleRequestStatus(mod);
  if (asked !== null) return asked;
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
  for (const w of plugin.workbenches ?? []) {
    const installed = installs.workbenches?.get(w.name);
    if (installed?.plugin === plugin.name && installed.version !== w.version)
      parts.push({
        kind: "workbench",
        name: w.name,
        installed: installed.version,
        library: w.version,
      });
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

/** One part an update rewrites. MCP servers have no versions and are replaced whole. */
export interface ChangedPart {
  kind: "skill" | "hooks" | "mcp" | "workbench";
  name: string;
  installed: string;
  library: string;
}

/**
 * The mark an Agent's plugin row carries while the plugin's server module does not run on the
 * Agent's server: off, awaiting the administrator, stopped by the administrator, failed to load (or
 * runs without part of itself), or listed and waiting for a restart.
 */
export type AgentModuleMarkKind = "off" | "awaiting" | "stopped" | "failed" | "restart";

/**
 * What the viewer can do about it: enable the module, ask the administrator to, or nothing.
 */
export type AgentModuleAction = "enable" | "request" | null;

export interface AgentModuleMark {
  kind: AgentModuleMarkKind;
  action: AgentModuleAction;
  /** Why, for `failed`. */
  reason?: string;
}

/** Who looks at the mark, and where the Agent lives. */
export interface ModuleViewer {
  /** The server's administrator. */
  isAdmin: boolean;
  /** The Agent lives on a machine, whose plugin list this server keeps. */
  onMachine: boolean;
}

/**
 * The mark of a plugin's server module on an Agent's row, and its action; null while the module
 * runs there (or the server says nothing about it).
 *
 * - On this server, a module that is off can be enabled at once when it is built in or the viewer
 *   is the administrator, and asked for otherwise. One awaiting the administrator, or stopped by
 *   them, offers a member nothing more — the standing ask, or the standing "no", is the
 *   administrator's to answer — and offers the administrator to enable it right there.
 * - On a machine — reached only by the administrator — this server can list a module for it only
 *   when the machine's build ships it; any other module is installed for that machine on the
 *   Plugins page, so its row offers nothing.
 * - A module that failed, or waits for a restart, is listed already: there is nothing to ask for.
 */
export function agentModuleMark(
  mod: PluginModuleStatus | undefined,
  viewer: ModuleViewer,
): AgentModuleMark | null {
  if (mod === undefined || mod.state === "running") return null;
  if (mod.state === "failed" || mod.state === "unsatisfied") {
    return { kind: "failed", action: null, reason: mod.reason ?? "" };
  }
  if (mod.state === "restart") return { kind: "restart", action: null };
  const kind: AgentModuleMarkKind =
    mod.request?.status === "pending"
      ? "awaiting"
      : mod.request?.status === "declined"
        ? "stopped"
        : "off";
  if (viewer.onMachine) return { kind, action: mod.builtin ? "enable" : null };
  if (kind !== "off") return { kind, action: viewer.isAdmin ? "enable" : null };
  return { kind, action: mod.builtin || viewer.isAdmin ? "enable" : "request" };
}
