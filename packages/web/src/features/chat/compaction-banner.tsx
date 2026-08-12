/**
 * Compaction row: one StepBanner across running/done/failed (same shell as the MCP
 * connect row and the reasoning-&-tools group header) — mode while running, outcome plus
 * wall time once settled, failures on a single line.
 * Doesn't show Tokens: the row only needs to state whether compaction happened and whether it
 * succeeded. Compaction's cost lands in different places depending on when it occurs — compaction
 * that happens **mid-turn** counts toward that turn's stats line and cost; compaction **after a
 * turn ends** and manual compaction both go into the Session total (the Trace page lists
 * compaction turns separately); see the task-stats module comments.
 */
import { S } from "../../lib/strings";
import type { CompactionItem } from "../../lib/omni/stream-model";
import { StepBanner } from "./step-banner";

export function CompactionBanner({ item }: { item: CompactionItem }) {
  if (item.running) {
    return (
      <StepBanner
        state="running"
        title={S.chat.compactionTitle}
        detail={item.mode}
        {...(item.beginTsMs !== undefined ? { liveSinceMs: item.beginTsMs } : {})}
      />
    );
  }
  const ok = item.status === "completed";
  return (
    <StepBanner
      state={ok ? "done" : "failed"}
      title={S.chat.compactionTitle}
      detail={
        ok
          ? S.chat.compactionDone(item.mode)
          : S.chat.compactionFailed(item.status ?? "failed", item.errorMessage)
      }
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
    />
  );
}
