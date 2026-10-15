/**
 * Where an Agent lives, for every surface that acts on one.
 *
 * An Agent is a directory on ONE server: this one, or a machine this server holds a connection
 * to. Each server keeps its own `agents/`, and nothing hands Agents from one to another — so the
 * same id on two servers names two Agents (every machine has a `default_agent` of its own), and
 * an Agent is named by its machine and its id together. Every call about a machine's Agent goes
 * to that machine, through its proxy (`/server/<machineId>/api/…`); the endpoints that take a
 * trailing `machineId` (null = this server) are the ones a page passes it to.
 *
 * The settings page is one page for both: a machine's Agent is addressed with `?machine=<id>`
 * beside the `?tab=` it already carries, and the page hands the machine to everything under it
 * through {@link AgentLocationContext}, so a tab reads it rather than having it threaded through.
 *
 * Each machine's whole Agent list, for the pages that list Agents, is lib/machine-agent-lists.ts.
 */
import { createContext, useContext } from "react";

/** The query parameter that names the machine an Agent's settings page is about. */
export const MACHINE_PARAM = "machine";

/** The settings page of an Agent, wherever it lives, optionally opened on one tab. */
export function agentSettingsPath(agentId: string, machineId: string | null, tab?: string): string {
  const params = new URLSearchParams();
  if (machineId !== null) params.set(MACHINE_PARAM, machineId);
  if (tab !== undefined) params.set("tab", tab);
  const query = params.toString();
  return `/agents/${encodeURIComponent(agentId)}${query === "" ? "" : `?${query}`}`;
}

/** The machine an Agent page's address names, or null for this server. */
export function machineInSearch(params: URLSearchParams): string | null {
  const value = params.get(MACHINE_PARAM);
  return value === null || value === "" ? null : value;
}

/**
 * One key per Agent wherever it lives, for a map that holds Agents of several servers: the id
 * itself on this server — so every key a page kept before machines is still the same — and
 * `<machineId>/<agentId>` on a machine. Neither half can hold a `/` (an Agent id is a semantic
 * id, a machine id is base64url), so no two Agents share a key.
 */
export function agentKey(machineId: string | null, agentId: string): string {
  return machineId === null ? agentId : `${machineId}/${agentId}`;
}

/** The machine the Agent in view lives on; null for this server, and outside any Agent page. */
export const AgentLocationContext = createContext<string | null>(null);

/** The machine the Agent in view lives on (see {@link AgentLocationContext}). */
export function useAgentLocation(): string | null {
  return useContext(AgentLocationContext);
}
