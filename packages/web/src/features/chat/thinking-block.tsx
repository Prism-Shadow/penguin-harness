/**
 * A thinking item of the session's stream, drawn by the shared UI package's `ThinkingBlock`:
 * this binds the item's streaming state to the row's run state and labels. How its Request
 * ended is said by the line that follows the reply, not by the thinking.
 */
import { ThinkingBlock } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { ThinkingItem } from "../../lib/amsp/stream-model";

export function SessionThinking({ item }: { item: ThinkingItem }) {
  return (
    <ThinkingBlock
      state={item.streaming ? "running" : "done"}
      stateLabel={item.streaming ? S.chat.workRunning : S.chat.workDone}
      label={S.chat.thinking}
      text={item.thinking}
      startedAtMs={item.startedAtMs}
      durationMs={item.durationMs}
    />
  );
}
