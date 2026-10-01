/**
 * A thinking item of the session's stream, drawn by the shared UI package's `ThinkingBlock`:
 * this binds the item's streaming and stop state to the row's run state and labels.
 */
import { ThinkingBlock } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { ThinkingItem } from "../../lib/omni/stream-model";

export function SessionThinking({ item }: { item: ThinkingItem }) {
  const failed = item.stopReason !== undefined && item.stopReason !== "completed";
  const state = item.streaming ? "running" : failed ? "failed" : "done";
  return (
    <ThinkingBlock
      state={state}
      stateLabel={item.streaming ? S.chat.workRunning : failed ? item.stopReason : S.chat.workDone}
      label={S.chat.thinking}
      text={item.thinking}
      startedAtMs={item.startedAtMs}
      durationMs={item.durationMs}
      stopReason={failed ? item.stopReason : undefined}
    />
  );
}
