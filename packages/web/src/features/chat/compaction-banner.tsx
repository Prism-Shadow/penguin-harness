/**
 * Compaction banner: shows "Compaction in
 * progress (summarize/discard)" between compaction_begin and compaction_end, then a one-line
 * message once done.
 * Doesn't show Tokens: the banner only needs to state whether compaction happened and whether it
 * succeeded. Compaction's cost lands in different places depending on when it occurs — compaction
 * that happens **mid-turn** counts toward that turn's stats line and cost; compaction **after a
 * turn ends** and manual compaction both go into the Session total (the Trace page lists
 * compaction turns separately); see the task-stats module comments.
 */
import { S } from "../../lib/strings";
import type { CompactionItem } from "../../lib/omni/stream-model";

export function CompactionBanner({ item }: { item: CompactionItem }) {
  if (item.running) {
    return (
      <div className="anim-msg my-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        {S.chat.compactionRunning(item.mode)}
      </div>
    );
  }
  const text =
    item.status === "completed"
      ? S.chat.compactionDone(item.mode)
      : S.chat.compactionFailed(item.status ?? "failed");
  return <p className="my-1 font-mono text-xs text-gray-500 dark:text-gray-400">{text}</p>;
}
