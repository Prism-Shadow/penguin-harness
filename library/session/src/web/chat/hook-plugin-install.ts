/**
 * A hook plugin on the Agent a composer sends to: whether its hook package is there, and its
 * install. Goal mode's gate (goal-plugin-gate.ts) and the "+" menu's offers of composer modes the
 * Agent lacks (prompt-modes.ts) both go through it, so a mode is installed one way wherever it is
 * offered.
 *
 * The Agent is the one the conversation runs on, on the server that holds it — a machine's Agent
 * is asked about, and installed on, over there, the way every install goes
 * (lib/agent-plugin-install.ts): a machine is told to leave its plugin tables to this server. The
 * install is the Plugins page's own route, which also renews the Agent's cached runtimes, so the
 * next message already runs the package.
 */
import type { AgentPluginsInstallResponse } from "@prismshadow/penguin-server/api";

import { getAgentPlugins, installWithModules } from "@prismshadow/penguin-web/internal";

export interface HookPluginInstall {
  /** Whether the Agent has the plugin's hook package. Rejects when the list cannot be read. */
  check(): Promise<boolean>;
  /** Installs the plugin on the Agent; whether its hook package is there afterwards. Rejects when the install is refused. */
  install(): Promise<boolean>;
}

/** Whether an Agent's plugin list carries the hook package of `plugin` (it carries the plugin's name). */
export const hasHookPackage = (res: AgentPluginsInstallResponse, plugin: string): boolean =>
  res.hooks.some((hook) => hook.name === plugin);

/** The check and the install of `plugin` on one Agent; `machineId` is the machine that holds it (null = this server). */
export function hookPluginInstall(
  projectId: string,
  agentId: string,
  machineId: string | null,
  plugin: string,
): HookPluginInstall {
  return {
    check: async () => hasHookPackage(await getAgentPlugins(projectId, agentId, machineId), plugin),
    install: async () =>
      hasHookPackage(
        (await installWithModules({ projectId, agentId, machineId }, [plugin])).lists,
        plugin,
      ),
  };
}
