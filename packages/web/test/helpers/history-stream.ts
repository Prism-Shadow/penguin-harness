/**
 * The history stream, as a suite plays the server's side of it: every read the code under test
 * opens (its query, its handlers, whether it was closed), and the events a test sends on one — a
 * window framed the way the server frames it (`page`, whole-record `records` frames up to a frame
 * budget, a record longer than that as `part`s, `done`), progress, the fill's end, an error.
 *
 * It stands at the controller's boundary (`openHistory` / `openBody`), the one the socket client
 * sits behind in the app; what the socket does underneath — acks, re-issues, beats — is pinned by
 * api-socket.test.ts.
 */
import type {
  HistoryMessage,
  HistoryProgress,
  MessagesLiveTail,
  MessagesPageInfo,
} from "@prismshadow/penguin-server/api";
import type { HistoryStreamHandlers, HistoryStreamQuery } from "../../src/api/sse";
import type { OpenBody, OpenHistory } from "../../src/lib/history/history-read";

export interface FakeRead {
  query: HistoryStreamQuery;
  handlers: HistoryStreamHandlers;
  closed: boolean;
  /** A window (or the error) has been sent on it. */
  answered: boolean;
}

export interface FakeBodyRead {
  ref: string;
  handlers: HistoryStreamHandlers;
  closed: boolean;
}

/** What one window holds, as the server would assemble it. */
export interface WindowContent {
  messages: HistoryMessage[];
  page?: MessagesPageInfo;
  live?: MessagesLiveTail;
  serverNowMs?: number | null;
}

/** One event of the stream, by name. */
export type StreamEvent =
  | { name: "page"; data: Parameters<NonNullable<HistoryStreamHandlers["onPage"]>>[0] }
  | {
      name: "records" | "part";
      data: Parameters<NonNullable<HistoryStreamHandlers["onRecords"]>>[0];
    }
  | { name: "done"; data: { windowId: string } };

/**
 * A window's events, cut as the server cuts them: whole record lines into frames of at most
 * `frameChars` characters, and a line longer than that into parts of `frameChars` each.
 */
export function windowEvents(
  content: WindowContent,
  { windowId = "w1", frameChars = 64 * 1024 }: { windowId?: string; frameChars?: number } = {},
): StreamEvent[] {
  const lines = content.messages.map((m) => `${JSON.stringify(m)}\n`);
  const events: StreamEvent[] = [
    {
      name: "page",
      data: {
        windowId,
        count: content.messages.length,
        bytes: lines.join("").length,
        ...(content.page !== undefined ? { page: content.page } : {}),
        ...(content.live !== undefined ? { live: content.live } : {}),
        serverNowMs: content.serverNowMs ?? null,
      },
    },
  ];
  let offset = 0;
  let frame = "";
  const flush = (): void => {
    if (frame === "") return;
    events.push({ name: "records", data: { windowId, offset, text: frame } });
    offset += frame.length;
    frame = "";
  };
  for (const line of lines) {
    if (line.length > frameChars) {
      flush();
      for (let at = 0; at < line.length; at += frameChars) {
        const text = line.slice(at, at + frameChars);
        const last = at + frameChars >= line.length;
        events.push({ name: "part", data: { windowId, offset, text, last } });
        offset += text.length;
      }
      continue;
    }
    if (frame.length + line.length > frameChars) flush();
    frame += line;
  }
  flush();
  events.push({ name: "done", data: { windowId } });
  return events;
}

/** Delivers events to a read's handlers, as the socket dispatches them by name. */
export function deliver(handlers: HistoryStreamHandlers, events: readonly StreamEvent[]): void {
  for (const event of events) {
    if (event.name === "page") handlers.onPage?.(event.data);
    else if (event.name === "done") handlers.onDone?.(event.data.windowId);
    else handlers.onRecords?.(event.data, event.name);
  }
}

export class FakeHistoryStream {
  readonly reads: FakeRead[] = [];
  readonly bodies: FakeBodyRead[] = [];

  readonly open: OpenHistory = (query, handlers) => {
    const read: FakeRead = { query, handlers, closed: false, answered: false };
    this.reads.push(read);
    return {
      close: () => {
        read.closed = true;
      },
    };
  };

  readonly openBody: OpenBody = (ref, handlers) => {
    const read: FakeBodyRead = { ref, handlers, closed: false };
    this.bodies.push(read);
    return {
      close: () => {
        read.closed = true;
      },
    };
  };

  /** The oldest read still open and unanswered whose query `matches`; throws when there is none. */
  next(matches: (query: HistoryStreamQuery) => boolean): FakeRead {
    const read = this.reads.find((r) => !r.closed && !r.answered && matches(r.query));
    if (read === undefined) throw new Error("no open history read matches");
    return read;
  }

  /** Sends a whole window on `read`, framed as the server frames it. */
  window(read: FakeRead, content: WindowContent, options?: Parameters<typeof windowEvents>[1]) {
    read.answered = true;
    deliver(read.handlers, windowEvents(content, options));
  }

  progress(read: FakeRead, progress: HistoryProgress): void {
    read.handlers.onProgress?.(progress);
  }

  /** The server's terminal error on `read`. */
  fail(read: FakeRead, message: string, code = "test_failure"): void {
    read.answered = true;
    read.handlers.onError({ code, message });
  }
}

/** A progress report: `done` of `total` bytes in `phase`, from machine `m1`. */
export function progressOf(
  phase: HistoryProgress["phase"],
  done: number,
  total: number,
  waiting: HistoryProgress["waiting"] = null,
): HistoryProgress {
  return {
    phase,
    machineId: "m1",
    doneBytes: done,
    totalBytes: total,
    doneLines: 0,
    totalLines: 0,
    waiting,
  };
}
