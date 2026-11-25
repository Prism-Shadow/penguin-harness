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
 * - A plugin that also ships server modules brings them along (lib/agent-plugin-install.ts): the
 *   install answers what became of each, and on a machine this server lists a module the machine
 *   ships for it. The Agent is then read again at once and once more a few seconds later, when
 *   the machine has had time to take the listing.
 * - The module of an installed plugin can be asked for on its own (`askModuleOnAgent`): this
 *   server applies the install's rule to it; for a machine's Agent, this server lists a module
 *   the machine ships, the same way an install does.
 */
import type {
  PluginItem,
  PluginModuleStatus,
  PluginUninstallResponse,
} from "@prismshadow/penguin-server/api";
import { toastAttention, toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import { ApiError } from "@prismshadow/penguin-web/internal";
import {
  installWithModules,
  type AgentPluginInstall,
  type ModuleOutcome,
} from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { toastApiError } from "@prismshadow/penguin-web/internal";
import { agentInstalls, installsKey, rereadInstalls, withoutPlugin } from "./agent-installs";

/** The Agent a write is about, on the server it lives on. */
export interface AgentTarget {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
}

/** How long after this server listed a machine's module the Agent is read from it once more. */
const MACHINE_REREAD_MS = 3000;

/** Reads a machine's Agent again now and once more after {@link MACHINE_REREAD_MS}. */
function rereadAfterListing(target: AgentTarget): void {
  const { projectId, agentId, machineId } = target;
  rereadInstalls(projectId, machineId, agentId);
  setTimeout(() => rereadInstalls(projectId, machineId, agentId), MACHINE_REREAD_MS);
}

/**
 * Installs — or reinstalls, which is an update — library plugins on the Agent, from the library
 * of the server it lives on, with what that does to their server modules; the Agent's lists are
 * taken into `agentInstalls`. Throws what the install request threw.
 */
export async function installOnAgent(
  target: AgentTarget,
  names: string[],
): Promise<AgentPluginInstall> {
  const { projectId, agentId, machineId } = target;
  const done = await installWithModules(target, names);
  agentInstalls.accept(installsKey(projectId, machineId, agentId), done.lists);
  // After the answer is taken: a read started before it would be outdated by it.
  if (done.listedOnMachine) rereadAfterListing(target);
  return done;
}

/**
 * Asks for the server module of a plugin installed on the Agent: on this server the install's rule
 * pressed as a button (enabled, or asked of the administrator); on a machine, this server lists a
 * module the machine ships for it. What became of it is the outcome; throws what the request
 * threw on this server.
 */
export async function askModuleOnAgent(
  target: AgentTarget,
  mod: Pick<PluginModuleStatus, "plugin" | "package">,
): Promise<ModuleOutcome> {
  const { projectId, machineId } = target;
  if (machineId !== null) {
    try {
      await api.installPlugin(projectId, mod.package, machineId);
    } catch (e) {
      return { plugin: mod.plugin, action: "failed", reason: apiErrorText(e) };
    }
    rereadAfterListing(target);
    return { plugin: mod.plugin, action: "enabled" };
  }
  const res = await api.askPluginModule(projectId, mod.plugin);
  const action = res.moduleActions.find((a) => a.plugin === mod.plugin);
  // Nothing done is what an ask answers when the module already runs: as good as enabled.
  if (action === undefined) return { plugin: mod.plugin, action: "enabled" };
  return action.action === "failed"
    ? { plugin: mod.plugin, action: "failed", reason: action.reason ?? "" }
    : { plugin: mod.plugin, action: action.action };
}

/** Toasts what an ask for `title`'s server module came to. */
export function toastModuleAsked(title: string, outcome: ModuleOutcome): void {
  const words = S.agentPlugins.module.asked;
  switch (outcome.action) {
    case "enabled":
      toastSuccess(words.enabled(title));
      return;
    case "requested":
      toastSuccess(words.requested(title));
      return;
    case "blocked":
      toastAttention(words.blocked(title));
      return;
    case "failed":
      toastAttention(words.failed(title, outcome.reason));
      return;
    case "install-on-machine":
      toastAttention(words.onMachine(title));
      return;
  }
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
