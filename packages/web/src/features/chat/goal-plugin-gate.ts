/**
 * Goal mode's plugin check in the composer.
 *
 * A goal runs on the goal plugin's hook package, installed per Agent. Without it the server
 * refuses the goal's first Task — and on a new conversation that refusal arrives after the
 * Session was created for it. So the composer asks the moment the goal chip is engaged: while
 * the plugin is missing it says so above the input, offers to install it right there, and holds
 * Send until it is in, so nothing is created for a goal that cannot start. The server's 409
 * stays the backstop: a check that cannot be read holds nothing.
 *
 * The Agent is the one the conversation runs on, on the server that holds it — a machine's Agent
 * is asked about, and installed on, over there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentPluginsInstallResponse } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { getAgentPlugins, installAgentPlugins } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

/** The library plugin goal mode runs on; its hook package carries the same name. */
export const GOAL_PLUGIN = "goal";

export interface GoalPluginGate {
  /** Whether the Agent has the goal hook package. Rejects when the list cannot be read. */
  check(): Promise<boolean>;
  /** Installs the goal plugin on the Agent; whether its hook package is there afterwards. Rejects when the install is refused. */
  install(): Promise<boolean>;
}

const hasGoalHook = (res: AgentPluginsInstallResponse): boolean =>
  res.hooks.some((hook) => hook.name === GOAL_PLUGIN);

/** The gate for one Agent; `machineId` is the machine that holds it (null = this server). */
export function goalPluginGate(
  projectId: string,
  agentId: string,
  machineId: string | null,
): GoalPluginGate {
  return {
    check: async () => hasGoalHook(await getAgentPlugins(projectId, agentId, machineId)),
    install: async () =>
      hasGoalHook(await installAgentPlugins(projectId, agentId, [GOAL_PLUGIN], machineId)),
  };
}

/**
 * Where the check stands while the goal chip is engaged. `unknown` is everything that decides
 * nothing: goal mode off, no gate, or a check that could not be read.
 */
export type GoalPluginStatus = "unknown" | "checking" | "installed" | "missing" | "installing";

/**
 * The composer's side of the gate: checks whenever the chip is engaged (again on every
 * engagement, and when the gate changes — another Agent, another machine), and installs on
 * request. A failed install says why in a toast and leaves the plugin missing. An answer that
 * arrives after the chip was dropped or the gate replaced is about a question nobody is asking
 * any more, and is ignored.
 */
export function useGoalPluginGate(
  gate: GoalPluginGate | null,
  goalOn: boolean,
): {
  status: GoalPluginStatus;
  /** Whether Send is held: the plugin is known to be missing, or being installed. */
  holdsSend: boolean;
  install: () => Promise<void>;
} {
  const [status, setStatus] = useState<GoalPluginStatus>("unknown");
  /** Bumped on every new question, so an answer to an old one lands nowhere. */
  const asked = useRef(0);

  useEffect(() => {
    const ask = ++asked.current;
    if (!goalOn || gate === null) {
      setStatus("unknown");
      return;
    }
    setStatus("checking");
    gate.check().then(
      (installed) => {
        if (asked.current === ask) setStatus(installed ? "installed" : "missing");
      },
      // Unreadable is not "missing": the server still refuses a goal it cannot start.
      () => {
        if (asked.current === ask) setStatus("unknown");
      },
    );
  }, [gate, goalOn]);

  const install = useCallback(async () => {
    if (gate === null) return;
    const ask = asked.current;
    setStatus("installing");
    try {
      const installed = await gate.install();
      if (asked.current === ask) setStatus(installed ? "installed" : "missing");
    } catch (err) {
      toastError(apiErrorText(err));
      if (asked.current === ask) setStatus("missing");
    }
  }, [gate]);

  return { status, holdsSend: status === "missing" || status === "installing", install };
}
