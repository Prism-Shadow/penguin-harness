/**
 * The reads of a machine's API that are a Session's history (history-routes.ts answers them from
 * the hub's copy of the machine's Trace lines): the history stream, an elided value, a record's
 * image, and a Trace file's events and analysis on either path.
 *
 * The forward (proxy.ts) keeps none of them in its answer cache (answer-cache.ts), even when the
 * copy cannot answer and the machine is asked: their bytes are the copy's to keep, byte for byte
 * and on disk, and a Trace page of a megabyte or two kept in memory as well would only push the
 * small reads a page open repeats (the models, an Agent's Skills and config) out of the cache's
 * bound.
 */

export const SESSION_READ = /^\/api\/sessions\/([^/]+)\/(history|trace-body|trace-image)$/;
export const SESSION_EVENTS = /^\/api\/sessions\/([^/]+)\/traces\/([1-9]\d{0,5})(\/analysis)?$/;
export const AGENT_EVENTS =
  /^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/traces\/([^/]+)\/([1-9]\d{0,5})(\/analysis)?$/;

/** Whether `remotePath` (a machine's `/api/…` path, no query) is a Session's history read. */
export function isHistoryRead(remotePath: string): boolean {
  return (
    SESSION_READ.test(remotePath) ||
    SESSION_EVENTS.test(remotePath) ||
    AGENT_EVENTS.test(remotePath)
  );
}
