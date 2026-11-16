/**
 * A thinking item of the session's stream, drawn by the shared UI package's `ThinkingBlock`:
 * this binds the item's streaming state to the row's run state and labels. How its Request
 * ended is said by the line that follows the reply, not by the thinking. A thinking block from a
 * history window may come folded: the row shows its head and tail and fetches the whole when it
 * is opened (elided-body.tsx).
 */
import { ThinkingBlock } from "@prismshadow/penguin-ui";
import { elidedPreview } from "../../lib/history/elided-preview";
import { S } from "../../lib/strings";
import type { ThinkingItem } from "../../lib/amsp/stream-model";
import { ElidedBodyNote, hasElidedNote } from "./elided-body";

export function SessionThinking({ item }: { item: ThinkingItem }) {
  return (
    <ThinkingBlock
      state={item.streaming ? "running" : "done"}
      stateLabel={item.streaming ? S.chat.workRunning : S.chat.workDone}
      label={S.chat.thinking}
      text={elidedPreview(item.thinking, item.elided, "payload.thinking", "\n\n…\n\n")}
      startedAtMs={item.startedAtMs}
      durationMs={item.durationMs}
      bodyNote={hasElidedNote(item) ? <ElidedBodyNote item={item} /> : undefined}
    />
  );
}
