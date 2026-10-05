import { Button } from "@prismshadow/penguin-ui";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { useProject } from "../../state/project";
import { pickDefaultAgent, useAiBridge } from "../ai-create";
import { tuningChatRequest } from "./tuning-chat-request";
import type { TuningChatTask } from "./tuning-chat-request";

export function TuningChatButton({
  task,
  agentId,
  modelRef,
  onOpen,
}: {
  task: TuningChatTask;
  agentId?: string | null;
  modelRef?: ModelRefDto | null;
  onOpen?: () => void;
}) {
  const { agents } = useProject();
  const { openAiChat } = useAiBridge();
  const runnerId = agentId === undefined ? pickDefaultAgent(agents)?.agentId : agentId;
  const ready = Boolean(runnerId && task.targetAgentId);

  return (
    <Button
      size="sm"
      disabled={!ready}
      onClick={() => {
        if (!ready || !runnerId) return;
        openAiChat({
          ...tuningChatRequest(runnerId, task),
          ...(modelRef ? { modelRef } : {}),
        });
        onOpen?.();
      }}
    >
      {task.action === "reproduce" ? S.tuningChat.reproduce : S.tuningChat.chooseMethod}
    </Button>
  );
}
