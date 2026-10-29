/**
 * Reads over the history streams, in the shape their callers want: progress as it comes, the
 * window once it is whole (or the whole of one folded value), the end of a fill, or one error in
 * words — and the stream closed once the read is over, since the socket re-issues any stream the
 * server ends and an open one would read its window again.
 *
 * A stream that breaks its own rules (frames lost, a record that is not JSON) is read again from
 * scratch, a couple of times, before the read fails: the server builds the window afresh under a
 * new id, so nothing half-assembled survives into the next attempt. A stream that merely dropped
 * is the socket's business — it is re-issued from its last event id and continues where it was.
 */
import type { HistoryProgress, HistoryStreamError } from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import type { HistoryStreamHandlers, HistoryStreamQuery, StreamConnection } from "../../api/sse";
import { apiErrorText } from "../api-error";
import { S } from "../strings";
import { HistoryStreamBroken, WindowAssembler } from "./window-assembler";
import type { HistoryWindow } from "./window-assembler";

/** Opens one history read of a Session (api/sse.ts `openHistoryStream`, the Session bound). */
export type OpenHistory = (
  query: HistoryStreamQuery,
  handlers: HistoryStreamHandlers,
) => StreamConnection;

/** Opens one trace-body read of a Session (api/sse.ts `openTraceBodyStream`, the Session bound). */
export type OpenBody = (ref: string, handlers: HistoryStreamHandlers) => StreamConnection;

/** How many times a broken stream is read again from scratch before its read fails. */
const FRESH_READS = 2;

/** The server's error event, in the page's words. */
function errorText(error: HistoryStreamError): string {
  return apiErrorText(new ApiError(0, error.code, error.message, undefined, error.details));
}

export interface HistoryReadSink {
  /** `delivered`: the window is already the caller's, so this is the fill behind it. */
  onProgress?: (progress: HistoryProgress, delivered: boolean) => void;
  onWindow?: (window: HistoryWindow) => void;
  /** The read is complete: a window read's fill has finished, or a `fill` read made its file whole. */
  onFilled?: () => void;
  onError: (message: string) => void;
}

export interface HistoryRead {
  /** Ends the read: the stream is closed, and nothing more reaches the sink. */
  close: () => void;
  /** Opens the same read again now (a Retry now while the server waits for the machine). */
  reissue: () => void;
}

/**
 * One history read. A window read without `fill` ends at its window; with `fill` it stays open
 * for the fill's progress until `filled`; a `fill` read ends when its file is whole.
 */
export function readHistory(
  open: OpenHistory,
  query: HistoryStreamQuery,
  sink: HistoryReadSink,
): HistoryRead {
  const fillsAfter = query.kind === "tail" && query.fill === true;
  let conn: StreamConnection | null = null;
  let over = false;
  let delivered = false;
  let fresh = 0;
  let assembler = new WindowAssembler();
  /** The connection now read; events of one this read has replaced are not its news. */
  let generation = 0;

  const finish = (): void => {
    over = true;
    conn?.close();
    conn = null;
  };
  const fail = (message: string): void => {
    if (over) return;
    finish();
    sink.onError(message);
  };
  const broken = (): void => {
    conn?.close();
    conn = null;
    if (fresh >= FRESH_READS) {
      fail(S.chat.historyTransfer.broken);
      return;
    }
    fresh += 1;
    start();
  };
  const guard = (step: () => void): void => {
    try {
      step();
    } catch (e) {
      if (!(e instanceof HistoryStreamBroken)) throw e;
      broken();
    }
  };

  function start(): void {
    assembler = new WindowAssembler();
    const gen = ++generation;
    const live = (): boolean => !over && gen === generation;
    conn = open(query, {
      onProgress: (progress) => {
        if (live()) sink.onProgress?.(progress, delivered);
      },
      onPage: (page) => {
        if (live() && !delivered) assembler.page(page);
      },
      onRecords: (frame, kind) => {
        if (live() && !delivered) guard(() => assembler.frame(frame, kind));
      },
      onDone: (windowId) => {
        if (!live()) return;
        if (query.kind === "fill") {
          finish();
          sink.onFilled?.();
          return;
        }
        // A window read again after it was delivered (a re-issue while filling) is not news.
        if (delivered) return;
        guard(() => {
          const window = assembler.done(windowId);
          // The server ends the stream after `done`: a `done` for no window held here is a broken
          // stream, read again from scratch — left open, the socket would re-issue it for ever.
          if (window === null) throw new HistoryStreamBroken("done for a window never begun");
          delivered = true;
          // The window is the caller's now; a fill read stays open, holding no copy of it.
          assembler = new WindowAssembler();
          if (!fillsAfter) finish();
          sink.onWindow?.(window);
        });
      },
      onFilled: () => {
        if (!live()) return;
        finish();
        sink.onFilled?.();
      },
      onError: (error) => {
        if (live()) fail(errorText(error));
      },
    });
  }

  start();
  return {
    close: () => {
      if (!over) finish();
    },
    reissue: () => {
      if (over) return;
      conn?.close();
      start();
    },
  };
}

export interface BodyReadSink {
  /** Bytes of the value that have reached this page's server so far, as it reports them. */
  onProgress?: (doneBytes: number) => void;
  onValue: (value: string) => void;
  onError: (message: string) => void;
}

/**
 * One trace-body read: the value's pieces, in order and by offset (a piece sent again after a
 * resume is skipped), joined into the whole value at `done`.
 */
export function readBody(open: OpenBody, ref: string, sink: BodyReadSink): { close: () => void } {
  let conn: StreamConnection | null = null;
  let over = false;
  let fresh = 0;
  let value = "";
  let generation = 0;

  const finish = (): void => {
    over = true;
    conn?.close();
    conn = null;
  };
  const fail = (message: string): void => {
    if (over) return;
    finish();
    sink.onError(message);
  };

  function start(): void {
    value = "";
    const gen = ++generation;
    const live = (): boolean => !over && gen === generation;
    conn = open(ref, {
      onProgress: (progress) => {
        if (live()) sink.onProgress?.(progress.doneBytes);
      },
      onRecords: (frame) => {
        if (!live()) return;
        if (frame.offset > value.length) {
          // Pieces were lost: read the value again from its start.
          conn?.close();
          conn = null;
          if (fresh >= FRESH_READS) {
            fail(S.chat.historyTransfer.broken);
            return;
          }
          fresh += 1;
          start();
          return;
        }
        value += frame.text.slice(value.length - frame.offset);
      },
      onDone: () => {
        if (!live()) return;
        finish();
        const whole = value;
        value = "";
        sink.onValue(whole);
      },
      onError: (error) => {
        if (live()) fail(errorText(error));
      },
    });
  }

  start();
  return {
    close: () => {
      if (!over) finish();
    },
  };
}
