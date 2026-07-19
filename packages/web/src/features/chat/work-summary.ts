/**
 * Summary for the "Reasoning & Tools" group header (pure logic, unit-testable): step count only
 * counts **tool calls** (thinking doesn't count as a step).
 *
 * Duration is computed as the **union of time intervals**: overlapping time from parallel tool
 * calls is counted only once, presenting the group's wall-clock working time rather than the sum
 * of each item's duration (naive per-item summation would report 15-way parallel work spanning
 * 9 minutes as 99 minutes). Intervals follow the same settlement convention as each item's
 * durationMs (see settleToolDuration in stream-model.ts): thinking is [startedAtMs, +durationMs];
 * a tool's durationMs = argument-generation segment + execution segment (approval wait time is
 * excluded), and the two segments are not adjacent on the timeline, so they must be split back
 * into two intervals using the same formula: [argStartedAtMs, +generation segment] and
 * [approvalAtMs ?? callStartedAtMs, +execution segment] — computing the whole span from the
 * execution start point would shift the generation segment into the execution period, producing
 * false overlap with parallel tools. Gaps between intervals (waiting for the model's next step)
 * are not counted; a segment missing a start point can't be checked for overlap and falls back to
 * plain summation.
 */
import type { ChatItem } from "../../lib/omni/stream-model";

export function summarizeWork(items: ChatItem[]): { steps: number; durationMs: number } {
  let steps = 0;
  let durationMs = 0;
  const intervals: [number, number][] = [];
  const add = (startMs: number | undefined, spanMs: number) => {
    if (spanMs <= 0) return;
    if (startMs === undefined) durationMs += spanMs;
    else intervals.push([startMs, startMs + spanMs]);
  };
  for (const it of items) {
    if (it.kind === "thinking") {
      if (it.durationMs !== undefined) add(it.startedAtMs, it.durationMs);
      continue;
    }
    if (it.kind !== "tool_call") continue;
    steps += 1;
    if (it.durationMs === undefined) continue;
    const genMs =
      it.argStartedAtMs !== undefined && it.callStartedAtMs !== undefined
        ? Math.min(it.durationMs, Math.max(0, it.callStartedAtMs - it.argStartedAtMs))
        : 0;
    add(it.argStartedAtMs, genMs);
    add(it.approvalAtMs ?? it.callStartedAtMs, it.durationMs - genMs);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let curStart: number | null = null;
  let curEnd = 0;
  for (const [start, end] of intervals) {
    if (curStart === null || start > curEnd) {
      if (curStart !== null) durationMs += curEnd - curStart;
      curStart = start;
      curEnd = end;
    } else if (end > curEnd) {
      curEnd = end;
    }
  }
  if (curStart !== null) durationMs += curEnd - curStart;
  return { steps, durationMs };
}
