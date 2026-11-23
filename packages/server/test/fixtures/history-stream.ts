/**
 * What the history-stream suites share: a reader of a `history` stream's events as the Web App
 * reads them (SSE over HTTP here — the socket carries the same events as frames), a clock the
 * test moves for the sync job's timers, and Trace lines to serve.
 */
import type { HistoryRecords } from "../../src/api/types.js";

export interface StreamEvent {
  event: string;
  id: string | null;
  data: string;
}

/** Reads a `text/event-stream` body event by event; `stop()` cancels it (the reader leaving). */
export function eventReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  let ended = false;
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event: StreamEvent = { event: "message", id: null, data: "" };
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("id: ")) event.id = line.slice(4);
          else if (line.startsWith("event: ")) event.event = line.slice(7);
          else if (line.startsWith("data: ")) data.push(line.slice(6));
        }
        event.data = data.join("\n");
        events.push(event);
      }
    }
    ended = true;
  })();
  return {
    events,
    get ended() {
      return ended;
    },
    /** Every event but the beat. */
    named: () => events.filter((e) => e.event !== "ping"),
    has: (name: string) => events.some((e) => e.event === name),
    stop: async () => {
      await reader.cancel().catch(() => undefined);
      await pump;
    },
    finished: pump,
  };
}

/** The records a window's `records`/`part` events carry, joined and parsed back. */
export function windowRecords(events: readonly StreamEvent[]): unknown[] {
  let text = "";
  for (const e of events) {
    if (e.event !== "records" && e.event !== "part") continue;
    text += (JSON.parse(e.data) as HistoryRecords).text;
  }
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as unknown);
}

/** A clock for the sync job's timers that moves only when the test says. */
export function manualClock() {
  let now = 1_000_000;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
    /** Moves the clock and fires every timer due by then, oldest first. */
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now || !timers.has(handle)) continue;
        timers.delete(handle);
        timer.fn();
      }
    },
  };
}

/** One Trace record line, the way the engine writes them. */
export function traceLine(
  i: number,
  text = `reply ${i}`,
  role: "user" | "assistant" = "assistant",
): string {
  return `${JSON.stringify({
    type: "model_msg",
    timestamp: `2026-10-29T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    payload: { type: "text", role, text },
  })}\n`;
}
