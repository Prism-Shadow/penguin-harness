/** The last displayed tail of a remote Session, scoped to the signed-in reader. */
import { HttpError } from "@prismshadow/penguin-library-http/errors";
import { openHistoryOut, sendError, sendWindow } from "@prismshadow/penguin-library-trace/history-stream";
import type { HistoryWindow } from "@prismshadow/penguin-library-trace/history-stream";
import type { SseRevocation } from "@prismshadow/penguin-library-trace/history-stream";

export interface OfflineReader {
  userId: string;
  projectId?: string;
}

/** Only committed Trace records have source lines. Live fragments and pending inputs expire with the link. */
export function committedWindow(window: HistoryWindow, count: number): HistoryWindow {
  let text = window.text;
  if (count < window.page.count) {
    let offset = 0;
    for (let line = 0; line < count; line++) offset = text.indexOf("\n", offset) + 1;
    text = text.slice(0, offset);
  }
  return {
    windowId: window.windowId,
    text,
    page: {
      windowId: window.windowId,
      count,
      bytes: Buffer.byteLength(text),
      ...(window.page.page === undefined ? {} : { page: window.page.page }),
      serverNowMs: null,
    },
  };
}

/** A finite history stream, including on a miss. No machine target, socket or sync job is opened. */
export function offlineHistory(
  request: Request,
  load: () => Promise<HistoryWindow | null>,
  revocation?: SseRevocation,
): Response {
  const { response, out } = openHistoryOut(request, revocation ? { revocation } : {});
  void (async () => {
    try {
      const cached = await load();
      if (cached === null) {
        throw new HttpError(
          404,
          "history_cache_miss",
          "No saved conversation history is available.",
        );
      }
      await sendWindow(out, cached, null);
    } catch (err) {
      if (!out.signal.aborted) await sendError(out, err);
    } finally {
      out.end();
    }
  })();
  return response;
}
