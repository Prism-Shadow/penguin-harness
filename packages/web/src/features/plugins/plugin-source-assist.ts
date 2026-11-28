/**
 * "Configure with AI" for a failed plugin download: opens a new chat in a temporary Workspace
 * with the Project's default Agent and a prefilled prompt naming the failed plugin(s) and error(s),
 * asking the Agent to inspect and configure plugin download sources and mirrors (such as npmmirror
 * or gh-proxy.com). Like plugin-repair.tsx, the prompt is placed in the composer and never sent
 * automatically so the user stays in control.
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { pickDefaultAgent, useAiBridge, type AiChatRequest } from "../ai-create";
import { S } from "../../lib/strings";

export interface FailedPluginDownload {
  specifier: string;
  error: string;
}

/** Builds the AI chat request for configuring plugin download sources after a failure. */
export function pluginSourceConfigRequest(
  failed: readonly FailedPluginDownload[],
  agents: readonly AgentSummary[],
): AiChatRequest | null {
  const agent = pickDefaultAgent(agents);
  if (agent === null) return null;
  return {
    agentId: agent.agentId,
    text: S.plugins.installModel.configureWithAiPrompt(failed),
    workspace: "",
  };
}

/** Returns a handler that opens an AI chat to help configure plugin download sources. */
export function usePluginSourceAssist(
  agents: readonly AgentSummary[],
  onOpened?: () => void,
): (failed: readonly FailedPluginDownload[]) => void {
  const { openAiChat } = useAiBridge();
  return (failed) => {
    const request = pluginSourceConfigRequest(failed, agents);
    if (request === null) {
      toastError(S.plugins.installModel.configureWithAiNoAgent);
      return;
    }
    onOpened?.();
    openAiChat(request);
  };
}
