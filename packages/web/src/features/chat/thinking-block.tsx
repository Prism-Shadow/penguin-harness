/**
 * Thinking block: one row within the "Reasoning & Tools" group — status
 * icon + "Thinking" + elapsed time, click to expand the full thinking text. Built on the
 * shared disclosure shell (disclosure-row.tsx), so its row metrics and color states are the
 * same source every other disclosure row uses; shares the running-state icons (in progress /
 * done / failed) with tool cards.
 */
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import type { ThinkingItem } from "../../lib/omni/stream-model";
import { StatusIcon } from "../../components/ui/status-icon";
import type { RunState } from "../../components/ui/status-icon";
import { DisclosureRow } from "./disclosure-row";
import { LiveDuration } from "./live-duration";
import { Md } from "./md";

export function ThinkingBlock({ item }: { item: ThinkingItem }) {
  const failed = item.stopReason !== undefined && item.stopReason !== "completed";
  const state: RunState = item.streaming ? "running" : failed ? "failed" : "done";
  const stateLabel = item.streaming
    ? S.chat.workRunning
    : failed
      ? item.stopReason
      : S.chat.workDone;

  return (
    <DisclosureRow
      sticky
      icon={<StatusIcon state={state} label={stateLabel} />}
      label={S.chat.thinking}
      trailing={
        <>
          <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
            {item.streaming ? (
              <LiveDuration sinceMs={item.startedAtMs} />
            ) : item.durationMs !== undefined ? (
              humanizeDuration(item.durationMs)
            ) : null}
          </span>
          {failed && <span className="font-mono text-xs text-gray-400">[{item.stopReason}]</span>}
        </>
      }
    >
      <div className="md-body anim-fade mx-3 mb-2 rounded-md bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-600 dark:bg-gray-900/60 dark:text-gray-400">
        <Md text={item.thinking} streaming={item.streaming} />
      </div>
    </DisclosureRow>
  );
}
