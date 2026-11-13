/**
 * A history window put back together from the `history` stream's events: `page` opens it,
 * `records` frames carry whole record lines (one `HistoryMessage` JSON per line), `part` frames
 * carry the pieces of one record longer than a frame, and `done` closes it.
 *
 * Every frame says where it starts in the window's text (`offset`, in UTF-16 code units — the
 * length of every frame's `text` before it), which is what makes a resumed stream safe: the
 * socket re-issues a dropped stream from its last event id, and the server either continues the
 * same window from that offset — a frame the assembler already holds is skipped, so no record
 * comes twice — or rebuilds it under a new window id, whose `page` discards the window in part.
 * A frame that starts past what is held means frames were lost, and the window cannot be trusted:
 * that is an error, never a window with a hole in it.
 */
import type {
  HistoryMessage,
  HistoryPage,
  HistoryRecords,
  MessagesLiveTail,
  MessagesPageInfo,
} from "@prismshadow/penguin-server/api";

/** One window, whole: its records in order and what its `page` said beside them. */
export interface HistoryWindow {
  windowId: string;
  messages: HistoryMessage[];
  page?: MessagesPageInfo;
  live?: MessagesLiveTail;
  serverNowMs: number | null;
}

/** The stream broke its own rules (a gap, a record that is not JSON, a count that does not add up). */
export class HistoryStreamBroken extends Error {
  constructor(detail: string) {
    super(`history stream: ${detail}`);
  }
}

export class WindowAssembler {
  #page: HistoryPage | null = null;
  /** Text of the current window taken so far. */
  #offset = 0;
  /** The text of a record whose pieces are still arriving. */
  #piece = "";
  #messages: HistoryMessage[] = [];

  /** A window begins. The same window again (a resumed stream) changes nothing. */
  page(page: HistoryPage): void {
    if (this.#page?.windowId === page.windowId) return;
    this.#page = page;
    this.#offset = 0;
    this.#piece = "";
    this.#messages = [];
  }

  /** A `records` or `part` frame; frames of a window already discarded are ignored. */
  frame(frame: HistoryRecords, kind: "records" | "part"): void {
    if (this.#page === null || frame.windowId !== this.#page.windowId) return;
    let text = frame.text;
    if (frame.offset > this.#offset) {
      throw new HistoryStreamBroken(`a frame at ${frame.offset} after ${this.#offset}`);
    }
    if (frame.offset < this.#offset) {
      // Sent again after a resume: only what lies past the held text is new.
      const held = this.#offset - frame.offset;
      if (held >= text.length) return;
      text = text.slice(held);
    }
    this.#offset += text.length;
    if (kind === "part") {
      this.#piece += text;
      if (frame.last !== true) return;
      const whole = this.#piece;
      this.#piece = "";
      this.#take(whole);
      return;
    }
    if (this.#piece !== "") throw new HistoryStreamBroken("whole records inside a split record");
    for (const line of text.split("\n")) this.#take(line);
  }

  /** The window is complete: it, or null when `windowId` names a window this one is not. */
  done(windowId: string | null): HistoryWindow | null {
    const page = this.#page;
    if (page === null || (windowId !== null && windowId !== page.windowId)) return null;
    if (this.#piece !== "") throw new HistoryStreamBroken("a split record never finished");
    if (this.#messages.length !== page.count) {
      throw new HistoryStreamBroken(`${this.#messages.length} records of ${page.count}`);
    }
    return {
      windowId: page.windowId,
      messages: this.#messages,
      ...(page.page !== undefined ? { page: page.page } : {}),
      ...(page.live !== undefined ? { live: page.live } : {}),
      serverNowMs: page.serverNowMs,
    };
  }

  #take(line: string): void {
    if (line.trim() === "") return;
    try {
      this.#messages.push(JSON.parse(line) as HistoryMessage);
    } catch {
      throw new HistoryStreamBroken("a record that is not JSON");
    }
  }
}
