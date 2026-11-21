/**
 * Installing library plugins on one Agent with what that does to their server modules, for every
 * caller that installs: the Plugins page and the Agent's settings (through the plugin feature's
 * `installOnAgent`, which also keeps the shared installs store), goal mode's composer and the
 * import dialog's porting Skill.
 *
 * - **This server's Agent**: the server writes the Agent part, then enables each installed
 *   plugin's module or asks the administrator to; its `moduleActions` are the outcomes.
 * - **A machine's Agent**: the hub keeps that machine's plugin list, so the machine is told to
 *   leave its own tables alone (`skipModules`) and only says how each module stands there. For a
 *   module that is off there and that the machine's own build ships (`builtin`), this server lists
 *   it for that machine (`installPlugin` with its id), which the fleet sync hands over without a
 *   download; `listedOnMachine` then says the Agent's answer is about to change. A module the
 *   machine does not ship is never listed by an install: the outcome says to install it for that
 *   machine on the Plugins page.
 * - A server that predates server modules answers neither field: nothing to do, no outcome.
 *
 * {@link toastInstall} words what happened as one toast: the install's own sentence, and after it
 * what became of the module.
 */
import type { AgentPluginsInstallResponse } from "@prismshadow/penguin-server/api";
import { toastAttention, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../api/endpoints";
import { apiErrorText } from "./api-error";
import { S } from "./strings";

/** The Agent an install is about, on the server it lives on. */
export interface InstallTarget {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
}

/** What an install did about one installed plugin's server module. */
export type ModuleOutcome =
  | { plugin: string; action: "enabled" | "requested" | "blocked" }
  | { plugin: string; action: "failed"; reason: string }
  /** A machine's Agent: the module does not run there and the machine's build does not ship it. */
  | { plugin: string; action: "install-on-machine" };

export interface AgentPluginInstall {
  /** The Agent's lists as its server answered the install. */
  lists: AgentPluginsInstallResponse;
  /** One outcome per installed plugin whose module the install did something about. */
  modules: ModuleOutcome[];
  /** This server listed a module for the Agent's machine: the machine's answer moves once it syncs. */
  listedOnMachine: boolean;
}

/**
 * Installs `names` on the Agent (see the header). Throws what the install request threw; a
 * machine listing that fails is the module's outcome (`failed`), not the install's.
 */
export async function installWithModules(
  target: InstallTarget,
  names: string[],
): Promise<AgentPluginInstall> {
  const { projectId, agentId, machineId } = target;
  if (machineId === null) {
    const lists = await api.installAgentPlugins(projectId, agentId, names, null);
    return {
      lists,
      modules: (lists.moduleActions ?? []).map((a) =>
        a.action === "failed"
          ? { plugin: a.plugin, action: "failed", reason: a.reason ?? "" }
          : { plugin: a.plugin, action: a.action },
      ),
      listedOnMachine: false,
    };
  }
  const lists = await api.installAgentPlugins(projectId, agentId, names, machineId, {
    skipModules: true,
  });
  const off = (lists.modules ?? []).filter((m) => names.includes(m.plugin) && m.state === "off");
  const modules: ModuleOutcome[] = [];
  let listedOnMachine = false;
  for (const mod of off) {
    if (!mod.builtin) {
      modules.push({ plugin: mod.plugin, action: "install-on-machine" });
      continue;
    }
    try {
      await api.installPlugin(projectId, mod.package, machineId);
      modules.push({ plugin: mod.plugin, action: "enabled" });
      listedOnMachine = true;
    } catch (e) {
      modules.push({ plugin: mod.plugin, action: "failed", reason: apiErrorText(e) });
    }
  }
  return { lists, modules, listedOnMachine };
}

/**
 * Toasts an install of `plugin`: `said` (the install's own sentence) alone when its module was
 * left as it was, else followed by what became of the module — enabled as a success, anything
 * that still wants a look (asked for, stopped, failed, to be installed on that machine) as an
 * advisory. `machine` names the Agent's machine for that last one.
 */
export function toastInstall(
  said: string,
  plugin: string,
  outcomes: readonly ModuleOutcome[],
  machine?: string,
): void {
  const outcome = outcomes.find((o) => o.plugin === plugin);
  const words = S.plugins.moduleInstall;
  if (outcome === undefined) {
    toastSuccess(said);
    return;
  }
  switch (outcome.action) {
    case "enabled":
      toastSuccess(words.enabled(said));
      return;
    case "requested":
      toastAttention(words.requested(said));
      return;
    case "blocked":
      toastAttention(words.blocked(said));
      return;
    case "failed":
      toastAttention(words.failed(said, outcome.reason));
      return;
    case "install-on-machine":
      toastAttention(words.onMachine(said, machine ?? ""));
      return;
  }
}
