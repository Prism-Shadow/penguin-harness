/**
 * Installing and uninstalling a library plugin on one Agent, as the Plugins page and the Agent's
 * own settings both do it: the request on the server the Agent lives on, and what its answer
 * writes into the shared installs store (agent-installs.ts), so both pages show the same thing
 * the moment either one writes. No toast and no dialog: what to say, and when, is the caller's.
 *
 * - An install — or a reinstall, which is an update — is one request for any number of the
 *   library's plugins; its answer is the Agent's lists, taken into the store as they are.
 * - An uninstall is one request for the whole plugin, which the server takes apart part by part.
 *   Afterwards the store drops the plugin's parts (when the library entry is known) and the Agent
 *   is read again to confirm. "Nothing of it is here" (404 `plugin_not_installed`) is the state
 *   asked for, so it counts as done; any other failure is thrown.
 * - A machine older than a request answers it 404 with another code (or none): such a machine
 *   needs an update, which is what the toast says instead of the bare error.
 */
import type {
  AgentPluginsInstallResponse,
  PluginItem,
  PluginUninstallResponse,
} from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { agentInstalls, installsKey, rereadInstalls, withoutPlugin } from "./agent-installs";

/** The Agent a write is about, on the server it lives on. */
export interface AgentTarget {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
}

/**
 * Installs — or reinstalls, which is an update — library plugins on the Agent, from the library
 * of the server it lives on; the answer is taken into `agentInstalls`. Throws what the request
 * threw.
 */
export async function installOnAgent(
  target: AgentTarget,
  names: string[],
): Promise<AgentPluginsInstallResponse> {
  const { projectId, agentId, machineId } = target;
  const res = await api.installAgentPlugins(projectId, agentId, names, machineId);
  agentInstalls.accept(installsKey(projectId, machineId, agentId), res);
  return res;
}

export type UninstallOutcome =
  | { kind: "removed"; failed: NonNullable<PluginUninstallResponse["failed"]> }
  /** 404 `plugin_not_installed`: nothing of it was there, which is the state asked for. */
  | { kind: "nothing-left" };

/** Whether a failed request is the server saying the Agent carries nothing of the plugin. */
const nothingInstalled = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 404 && e.code === "plugin_not_installed";

/**
 * One DELETE for the whole plugin. Afterwards the store drops the plugin's parts
 * (`withoutPlugin`, when the library entry is known) and the Agent is read again
 * (`rereadInstalls`). Throws anything else.
 */
export async function uninstallFromAgent(
  target: AgentTarget,
  name: string,
  plugin: PluginItem | null,
): Promise<UninstallOutcome> {
  const { projectId, agentId, machineId } = target;
  const res = await api
    .uninstallAgentPlugin(projectId, agentId, name, machineId)
    .catch((e: unknown) => {
      if (nothingInstalled(e)) return null;
      throw e;
    });
  // What it removed is known; the Agent is read again to confirm it.
  const key = installsKey(projectId, machineId, agentId);
  const before = agentInstalls.get(key).value;
  if (before !== null && plugin !== null) agentInstalls.accept(key, withoutPlugin(before, plugin));
  rereadInstalls(projectId, machineId, agentId);
  return res === null ? { kind: "nothing-left" } : { kind: "removed", failed: res.failed ?? [] };
}

/** A 404 from a machine that is not `plugin_not_installed`: the machine is older than the request. */
export function isOutdatedMachine(e: unknown, machineId: string | null): boolean {
  return machineId !== null && e instanceof ApiError && e.status === 404 && !nothingInstalled(e);
}

/** Toasts a failed write: the machine-outdated sentence for such a machine, the API error otherwise. */
export function toastWriteError(e: unknown, machineId: string | null): void {
  if (isOutdatedMachine(e, machineId)) toastError(S.errors.byCode.machine_outdated);
  else toastApiError(e);
}
