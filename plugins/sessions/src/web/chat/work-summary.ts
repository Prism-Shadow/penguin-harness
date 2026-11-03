import type { ChatItem } from "@prismshadow/penguin-web/internal";


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
