import { S } from "@prismshadow/penguin-web/internal";
import type { ThinkingItem } from "@prismshadow/penguin-web/internal";


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
