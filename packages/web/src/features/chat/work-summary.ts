/**
 * Summary for the "Reasoning & Tools" group header (pure logic, unit-testable): step count only
 * counts **tool calls** (thinking doesn't count as a step).
 *
 * Duration is the group's **real wall-clock span**: earliest segment start → latest segment end,
 * including everything in between — approval waits, gaps while the model decides its next step,
 * parallel work counted once. The header answers "how long did this group take", not "how much
 * compute happened inside it" (per-item cards carry the fine-grained settled durations).
 * Segment endpoints follow the same settlement convention as each item's durationMs (see
 * settleToolDuration in stream-model.ts): thinking is [startedAtMs, +durationMs]; a tool's
 * durationMs = argument-generation segment + execution segment (the approval wait between them
 * is excluded from the item's own duration, but lands inside the group span), so the endpoints
 * are [argStartedAtMs, +generation segment] and [approvalAtMs ?? callStartedAtMs, +execution
 * segment]. Segments missing a start point can't be placed on the timeline and fall back to
 * plain summation on top of the span. `startMs` is the earliest placed start — the anchor the
 * group header ticks from while an item is still in flight (once nothing is running the header
 * freezes at the computed span, so the displayed number never jumps backwards).
 */
import type { ChatItem } from "../../lib/omni/stream-model";

export function summarizeWork(items: ChatItem[]): {
  steps: number;
  durationMs: number;
  startMs?: number;
} {
  let steps = 0;
  let fallbackMs = 0;
  let minStart: number | undefined;
  let maxEnd: number | undefined;
  /** Group open = the earliest start stamp of ANY item, settled or not — a still-streaming first item must already anchor the live tick. */
  const seen = (startMs: number | undefined) => {
    if (startMs !== undefined && (minStart === undefined || startMs < minStart)) minStart = startMs;
  };
  const add = (startMs: number | undefined, spanMs: number) => {
    if (spanMs <= 0) return;
    if (startMs === undefined) {
      fallbackMs += spanMs;
      return;
    }
    seen(startMs);
    const end = startMs + spanMs;
    if (maxEnd === undefined || end > maxEnd) maxEnd = end;
  };
  for (const it of items) {
    if (it.kind === "thinking") {
      seen(it.startedAtMs);
      if (it.durationMs !== undefined) add(it.startedAtMs, it.durationMs);
      continue;
    }
    if (it.kind !== "tool_call") continue;
    steps += 1;
    seen(it.argStartedAtMs ?? it.callStartedAtMs ?? it.approvalAtMs);
    if (it.durationMs === undefined) continue;
    const genMs =
      it.argStartedAtMs !== undefined && it.callStartedAtMs !== undefined
        ? Math.min(it.durationMs, Math.max(0, it.callStartedAtMs - it.argStartedAtMs))
        : 0;
    add(it.argStartedAtMs, genMs);
    add(it.approvalAtMs ?? it.callStartedAtMs, it.durationMs - genMs);
  }
  const spanMs = minStart !== undefined && maxEnd !== undefined ? maxEnd - minStart : 0;
  return {
    steps,
    durationMs: spanMs + fallbackMs,
    ...(minStart !== undefined ? { startMs: minStart } : {}),
  };
}
