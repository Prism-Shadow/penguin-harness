import { S } from "../../lib/strings";
import type { AiChatRequest } from "../ai-create/ai-bridge";
import { composeAiPrompt } from "../ai-create/ai-create-prompt";

export type TuningChatTask =
  | { action: "reproduce"; targetAgentId: string }
  | { action: "optimize"; targetAgentId: string; benchmarkId: string; note: string };

/** The new entry carries task identity; the selected Skill resolves its own method settings. */
export function tuningChatRequest(agentId: string, task: TuningChatTask): AiChatRequest {
  const optimize = task.action === "optimize";
  return {
    agentId,
    text: optimize
      ? composeAiPrompt(
          task.note,
          S.tuningChat.optimizePrompt(task.targetAgentId, task.benchmarkId),
        )
      : S.tuningChat.reproducePrompt(task.targetAgentId),
    skills: [optimize ? "agent-optimization" : "benchmark-reproduction"],
    source: "benchmark",
  };
}
