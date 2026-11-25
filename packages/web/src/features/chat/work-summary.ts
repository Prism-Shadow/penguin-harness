import {
  localWorkTime,
  type ChatItem,
  type ThinkingItem,
  type ToolCallItem,
} from "../../lib/amsp/stream-model";
import { mergedIntervalMs } from "../../lib/amsp/task-stats";

/** The union of observed thinking, argument generation and execution in this group. */
export function summarizeWork(items: readonly ChatItem[]): {
  steps: number;
  durationMs?: number;
  startMs?: number;
} {
  let steps = 0;
  let liveStart: number | undefined;
  let localStart = 0;
  const settled: [number, number][] = [];

  function open(item: ThinkingItem | ToolCallItem, start: number | undefined) {
    if (start !== undefined && (liveStart === undefined || start < liveStart)) {
      liveStart = start;
      localStart = localWorkTime(item, start)!;
    }
  }

  function add(start: number | undefined, end: number) {
    if (start !== undefined && end >= start) settled.push([start, end]);
  }

  for (const item of items) {
    if (item.kind === "thinking" && item.startedAtMs !== undefined) {
      if (item.durationMs !== undefined) add(item.startedAtMs, item.startedAtMs + item.durationMs);
      else if (item.streaming) open(item, item.startedAtMs);
    }
    if (item.kind !== "tool_call" || item.outputOnly) continue;
    steps++;
    const { argStartedAtMs, callStartedAtMs, approvalAtMs } = item;
    if (callStartedAtMs !== undefined) add(argStartedAtMs, callStartedAtMs);
    else if (item.callStreaming) open(item, argStartedAtMs);

    if (item.decision === "deny" || item.decision === "forbidden") continue;
    const execution = approvalAtMs ?? callStartedAtMs;
    if (execution === undefined) continue;
    if (item.durationMs !== undefined) {
      const generation =
        argStartedAtMs !== undefined && callStartedAtMs !== undefined
          ? Math.max(0, callStartedAtMs - argStartedAtMs)
          : 0;
      add(execution, execution + Math.max(0, item.durationMs - generation));
    } else if (!item.outputComplete && (item.decision === "allow" || item.outputStreaming)) {
      open(item, execution);
    }
  }

  if (liveStart === undefined) {
    return settled.length ? { steps, durationMs: mergedIntervalMs(settled) } : { steps };
  }

  // From the earliest open interval onwards the clock already covers every overlapping step.
  // Only the union before that point needs carrying into the live duration.
  const since = liveStart;
  const earlier = settled
    .filter(([start]) => start < since)
    .map(([start, end]): [number, number] => [start, Math.min(end, since)]);
  return { steps, startMs: localStart - mergedIntervalMs(earlier) };
}
