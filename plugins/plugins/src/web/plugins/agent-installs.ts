/**
 * What each Agent has installed, as the plugin market reads it: one `getAgentPlugins` per Agent,
 * on the server the Agent lives on, kept in a store keyed by Project, machine and Agent
 * (lib/read-store.ts) and remembered across reloads (lib/machine-cache.ts). So the market opens
 * with the statuses it last showed, and an answer that is late, failed or out of reach changes
 * nothing on screen until an answer says something different.
 *
 * An Agent's installs are either known (an answer from this page load, or the last one
 * remembered) or unknown (nothing yet, or a failed read with nothing to fall back on). An unknown
 * Agent counts neither as having a plugin nor as lacking it (plugin-status.ts `libraryUsage`).
 *
 * One read per Agent: a second reader joins the first; a change to the list of Agents reads only
 * the Agents it adds; an Agent on a machine that cannot be asked is not read until it can, and is
 * read again when it can. A write that brings the Agent's lists back is taken as its answer.
 */
import { useMemo } from "react";
import type { AgentPluginsInstallResponse, PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import {
  cachedAgentInstalls,
  forgetAgentInstalls,
  rememberAgentInstalls,
} from "../../lib/machine-cache";
import { createReadStore, readKey, useReads } from "../../lib/read-store";
import type { ReadStore } from "../../lib/read-store";
import type { AgentInstalls, InstalledMap } from "./plugin-status";

/** The part of a key that says which kind of read it is (see `readKey`). */
const KIND = "installs";

/** The store key of one Agent's installs: the Project, the server it lives on (null: this one), the Agent. */
export function installsKey(projectId: string, machineId: string | null, agentId: string): string {
  return readKey(projectId, machineId, KIND, agentId);
}

/** The Project, machine and Agent a key names, or null for a key that is not an installs key. */
function keyParts(
  key: string,
): { projectId: string; machineId: string | null; agentId: string } | null {
  const [projectId, machine, kind, agentId, ...rest] = key.split("\0");
  if (projectId === undefined || kind !== KIND || agentId === undefined || rest.length > 0) {
    return null;
  }
  return {
    projectId,
    machineId: machine === "" || machine === undefined ? null : machine,
    agentId,
  };
}

/** Every Agent's installed lists, as last answered, in this page load or remembered from an earlier one. */
export const agentInstalls: ReadStore<AgentPluginsInstallResponse> =
  createReadStore<AgentPluginsInstallResponse>({
    storage: {
      load: (key) => {
        const parts = keyParts(key);
        return parts === null
          ? null
          : cachedAgentInstalls(parts.projectId, parts.machineId, parts.agentId);
      },
      save: (key, value) => {
        const parts = keyParts(key);
        if (parts !== null) {
          rememberAgentInstalls(parts.projectId, parts.machineId, parts.agentId, value);
        }
      },
      clear: (key) => {
        const parts = keyParts(key);
        if (parts !== null) forgetAgentInstalls(parts.projectId, parts.machineId, parts.agentId);
      },
    },
  });

/** Asks the Agent's server for its installed lists. */
const readInstalls = (projectId: string, machineId: string | null, agentId: string) => () =>
  api.getAgentPlugins(projectId, agentId, machineId);

/** Reads one Agent's lists again after a write that did not bring them back (an uninstall, Set up). */
export function rereadInstalls(projectId: string, machineId: string | null, agentId: string): void {
  const key = installsKey(projectId, machineId, agentId);
  agentInstalls.invalidate(key);
  void agentInstalls.read(key, readInstalls(projectId, machineId, agentId));
}

/** An install response's three lists (and its workbenches), folded into one Agent's snapshot entry. */
export function installsOf(res: AgentPluginsInstallResponse): AgentInstalls {
  return {
    workbenches: new Map((res.workbenches ?? []).map((w) => [w.name, w])),
    skills: new Map(res.skills.map((s) => [s.name, s.version])),
    hooks: new Map(res.hooks.map((h) => [h.name, h.version])),
    mcp: new Map(res.mcpServers.map((server) => [server.name, server])),
  };
}

/**
 * An Agent's lists after the plugin was taken apart on it: its skills, its hook package and the
 * MCP servers and workbenches it installed gone — what the DELETEs that succeeded left. A server
 * the user added under one of the plugin's names stays: it is not the plugin's.
 */
export function withoutPlugin(
  res: AgentPluginsInstallResponse,
  plugin: Pick<PluginItem, "name" | "skills" | "hooks" | "mcpServers" | "workbenches">,
): AgentPluginsInstallResponse {
  const skills = new Set(plugin.skills.map((s) => s.name));
  const servers = new Set(plugin.mcpServers.map((s) => s.name));
  const workbenches = new Set((plugin.workbenches ?? []).map((w) => w.name));
  return {
    ...(res.workbenches !== undefined
      ? {
          workbenches: res.workbenches.filter(
            (w) => !(w.plugin === plugin.name && workbenches.has(w.name)),
          ),
        }
      : {}),
    skills: res.skills.filter((s) => !skills.has(s.name)),
    hooks: plugin.hooks.length > 0 ? res.hooks.filter((h) => h.name !== plugin.name) : res.hooks,
    mcpServers: res.mcpServers.filter((s) => !(s.plugin === plugin.name && servers.has(s.name))),
  };
}

/** An Agent whose installs the page shows. */
export interface InstallsTarget {
  /** What the page's install map names it by (lib/agent-location.ts `agentKey`). */
  key: string;
  agentId: string;
  /** The machine it lives on; null for this server. */
  machineId: string | null;
  /** Its server can be asked now: this server always, a machine while it is connected. */
  readable: boolean;
}

/** The installs the page shows, by target key. */
export interface AgentInstallsView {
  /** The targets whose installs are known, fresh or remembered. */
  installed: InstalledMap;
  /** The targets whose installs are not known: not answered yet, or failed with nothing to show. */
  unknown: ReadonlySet<string>;
  /** Of `unknown`, the targets whose read failed, with the failure in words. */
  failed: ReadonlyMap<string, string>;
}

/** One entry per answer object: an unchanged answer keeps its snapshot entry, so nothing re-renders. */
const folded = new WeakMap<AgentPluginsInstallResponse, AgentInstalls>();
const foldedOf = (res: AgentPluginsInstallResponse): AgentInstalls => {
  let entry = folded.get(res);
  if (entry === undefined) {
    entry = installsOf(res);
    folded.set(res, entry);
  }
  return entry;
};

/**
 * The installs of `targets` in `projectId` (lib/read-store.ts `useReads`): each Agent read when it
 * first appears or its server becomes askable again — unless answered within the last two
 * seconds — never because a neighbour arrived, and again whenever a write marked it stale.
 * Nothing already known is dropped while it is read again.
 */
export function useAgentInstalls(
  projectId: string | null,
  targets: readonly InstallsTarget[],
): AgentInstallsView {
  const states = useReads(
    agentInstalls,
    projectId === null
      ? []
      : targets.map((t) => ({
          key: installsKey(projectId, t.machineId, t.agentId),
          run: readInstalls(projectId, t.machineId, t.agentId),
          enabled: t.readable,
        })),
  );
  /** The targets' keys as a string: the same Agents keep the view below still. */
  const keys = projectId === null ? "" : targets.map((t) => t.key).join("\n");
  return useMemo(() => {
    const installed = new Map<string, AgentInstalls>();
    const unknown = new Set<string>();
    const failed = new Map<string, string>();
    const names = keys === "" ? [] : keys.split("\n");
    names.forEach((key, i) => {
      const state = states[i];
      if (state === undefined) return;
      if (state.value !== null) installed.set(key, foldedOf(state.value));
      else {
        unknown.add(key);
        if (state.error !== null) failed.set(key, state.error);
      }
    });
    return { installed, unknown, failed };
  }, [keys, states]);
}
