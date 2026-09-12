/**
 * Highlighting, off the main thread.
 *
 * Tokenizing is linear in the size of the file and runs to completion once it starts — roughly
 * four milliseconds per kilobyte, so half a megabyte of TypeScript is a couple of seconds. On the
 * main thread that is a couple of seconds of frozen scrolling, which is why the viewer used to
 * refuse to highlight anything large. Here it costs nothing anyone can feel: the code shows
 * unhighlighted, the colours arrive when they arrive, and the page stays live throughout.
 *
 * The protocol is one message each way, correlated by an id the caller mints, because several
 * blocks can settle at once and their answers come back in whatever order they finish.
 */
import { highlight } from "./highlighter-core";

export interface HighlightRequest {
  id: number;
  code: string;
  language: string;
  blockLines: boolean;
}

export interface HighlightResponse {
  id: number;
  html?: string;
  /** Present when the attempt threw; the caller renders the code unhighlighted. */
  error?: string;
}

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id, code, language, blockLines } = event.data;
  highlight(code, language, blockLines).then(
    (html) => {
      const done: HighlightResponse = html === undefined ? { id } : { id, html };
      self.postMessage(done);
    },
    (err: unknown) => {
      const failed: HighlightResponse = {
        id,
        error: err instanceof Error ? err.message : "failed",
      };
      self.postMessage(failed);
    },
  );
};
