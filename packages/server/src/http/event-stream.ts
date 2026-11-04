/**
 * A route that produces its own events, answered on either transport.
 *
 * The channel-backed streams (http/sse.ts) relay a Channel; the history streams compute their
 * events — a window, then Trace lines — and must be paced by the reader. This gives such a
 * route one sink: over the API socket it is the call's own answer (socket/stream-answer.ts),
 * credit flow, beat and release included; over HTTP it is SSE text, where every write waits
 * for the one before it to be taken, which is HTTP's own backpressure.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { answerOf } from "../socket/stream-answer.js";

/** Where a computing stream route sends its events. */
export interface EventSink {
  /** Aborts when the reader is gone (a cancel, a closed socket or connection). */
  readonly signal: AbortSignal;
  /** Resolves when an event of `size` may be sent (credit flow); rejects once the reader is gone. */
  writable(size: number): Promise<void>;
  send(event: string, id: string | null, data: string): Promise<void>;
  /** A `ping` whenever nothing was sent for `ms`. */
  beat(ms: number): void;
}

/** Answers `c` as an event stream that `run` writes; the stream ends when `run` settles. */
export function eventStream(
  c: Context,
  run: (sink: EventSink) => Promise<void>,
  log: (line: string) => void = () => undefined,
): Response {
  const failed = (err: unknown): void => {
    if (err instanceof Error && err.name === "AbortError") return;
    log(`[stream] ${c.req.path}: ${err instanceof Error ? err.message : String(err)}`);
  };
  const answer = answerOf(c.req.raw);
  if (answer !== null) {
    answer.start(200, { "content-type": "text/event-stream" });
    const sink: EventSink = {
      signal: answer.signal,
      writable: (size) => answer.writable(size),
      send: async (event, id, data) => answer.event(event, id, data),
      beat: (ms) => answer.beat(ms),
    };
    void run(sink)
      .catch((err: unknown) => {
        if (!answer.signal.aborted) failed(err);
      })
      .finally(() => answer.end("closed"));
    // The answer is the stream; the Response carries nothing (socket/serve.ts drops it).
    return new Response(null, { status: 200 });
  }
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache");
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    let beatMs: number | null = null;
    let beatTimer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (beatTimer !== null) clearTimeout(beatTimer);
      beatTimer = null;
      if (beatMs === null || controller.signal.aborted) return;
      beatTimer = setTimeout(() => void send("ping", null, "{}"), beatMs);
      beatTimer.unref?.();
    };
    let chain: Promise<void> = Promise.resolve();
    const send = (event: string, id: string | null, data: string): Promise<void> => {
      chain = chain.then(async () => {
        if (controller.signal.aborted) return;
        await stream.writeSSE({ event, data, ...(id !== null ? { id } : {}) });
        arm();
      });
      return chain;
    };
    const sink: EventSink = {
      signal: controller.signal,
      writable: async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        await chain;
      },
      send,
      beat: (ms) => {
        beatMs = ms;
        arm();
      },
    };
    try {
      await run(sink);
      await chain;
    } catch (err) {
      if (!controller.signal.aborted) failed(err);
    } finally {
      controller.abort();
      if (beatTimer !== null) clearTimeout(beatTimer);
    }
  });
}
