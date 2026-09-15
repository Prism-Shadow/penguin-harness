/**
 * The code viewer's highlighting entry point: the same call as before, answered on a worker.
 *
 * Tokenizing is linear in the size of the file — about four milliseconds per kilobyte of
 * TypeScript, measured on this app's own sources — and it runs to completion once it starts. On
 * the main thread that put a hard ceiling on what could be coloured at all, because half a
 * megabyte meant two seconds of frozen page. A worker removes the ceiling rather than raising it:
 * the code renders unhighlighted, the colours replace it when they land, and nothing blocks.
 *
 * The worker is created on the first call and kept for the page's life, so a conversation pays for
 * the engine and each grammar once. Where a worker cannot be had at all — a runtime without it, a
 * CSP that forbids it, a construction that throws — the work falls back to this thread, which is
 * exactly the old behaviour and still correct, only blocking.
 */
import type { HighlightRequest, HighlightResponse } from "./highlighter.worker";

/** undefined: not tried yet. null: unavailable here, use the main thread. */
let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, (response: HighlightResponse) => void>();

function settleAll(response: (id: number) => HighlightResponse): void {
  for (const [id, resolve] of pending) resolve(response(id));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const created = new Worker(new URL("./highlighter.worker.ts", import.meta.url), {
      type: "module",
    });
    created.onmessage = (event: MessageEvent<HighlightResponse>) => {
      const resolve = pending.get(event.data.id);
      if (resolve) {
        pending.delete(event.data.id);
        resolve(event.data);
      }
    };
    // A worker that dies takes every request in flight with it. Answer them as "no highlight"
    // rather than leaving their promises open forever, and send the next call to the main
    // thread instead of a socket that is gone.
    created.onerror = () => {
      worker = null;
      settleAll((id) => ({ id, error: "worker failed" }));
    };
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Highlights `code` as `language`, returning Shiki's dual-theme HTML, or undefined when the
 * language isn't one this bundle carries. Rejects only on an unexpected failure (chunk fetch,
 * grammar error); callers fall back to unhighlighted text either way.
 */
export async function highlightToHtml(
  code: string,
  language: string,
  options?: { blockLines?: boolean },
): Promise<string | undefined> {
  const blockLines = options?.blockLines === true;
  const w = getWorker();
  if (w === null) {
    // Imported here and not at the top: the engine is already in the worker's bundle, and a
    // static import would put a second copy of it on the main thread for every reader whose
    // worker works — which is all of them.
    const { highlight } = await import("./highlighter-core");
    return highlight(code, language, blockLines);
  }
  const id = (nextId += 1);
  const request: HighlightRequest = { id, code, language, blockLines };
  const answer = await new Promise<HighlightResponse>((resolve) => {
    pending.set(id, resolve);
    w.postMessage(request);
  });
  // The worker reports a failure rather than throwing across the boundary; treat it the way the
  // main-thread path treats one, so a caller sees the same unhighlighted fallback either way.
  if (answer.error !== undefined) return undefined;
  return answer.html;
}
