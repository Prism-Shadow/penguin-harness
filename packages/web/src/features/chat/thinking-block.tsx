/**
 * Thinking block: one row within the "Reasoning & Tools" group — status
 * icon + "Thinking" + elapsed time, click to expand the full thinking text. Shares the same row
 * style and set of running-state icons (in progress / done / failed) as tool cards.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import type { ThinkingItem } from "../../lib/omni/stream-model";
import { Chevron } from "../../components/ui/chevron";
import { StatusIcon } from "../../components/ui/status-icon";
import type { RunState } from "../../components/ui/status-icon";
import { LiveDuration } from "./live-duration";
import { Md } from "./md";

export function ThinkingBlock({ item }: { item: ThinkingItem }) {
  const [open, setOpen] = useState(false);
  const failed = item.stopReason !== undefined && item.stopReason !== "completed";
  const state: RunState = item.streaming ? "running" : failed ? "failed" : "done";
  const stateLabel = item.streaming
    ? S.chat.workRunning
    : failed
      ? item.stopReason
      : S.chat.workDone;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <StatusIcon state={state} label={stateLabel} />
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{S.chat.thinking}</span>
        <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
          {item.streaming ? (
            <LiveDuration sinceMs={item.startedAtMs} />
          ) : item.durationMs !== undefined ? (
            humanizeDuration(item.durationMs)
          ) : null}
        </span>
        {failed && <span className="font-mono text-xs text-gray-400">[{item.stopReason}]</span>}
        <span className="min-w-0 flex-1" />
        <Chevron open={open} className="text-gray-400" />
      </button>
      {open && (
        <div className="md-body anim-fade mx-3 mb-2 rounded-md bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-600 dark:bg-gray-900/60 dark:text-gray-400">
          <Md text={item.thinking} />
        </div>
      )}
    </div>
  );
}
