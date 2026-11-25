/**
 * Session ids carry the local wall-clock time they were created at
 * (`session-YYYY-MM-DD-HH-MM-SS-xxxxxxxx`); the listing orders and backfills by it when the
 * index row has no better timestamp.
 */
const SESSION_ID_TS_RE = /^session-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-[0-9a-f]{8}$/;

/** Derives creation time from the local timestamp embedded in session_id; returns null if it doesn't match. */
export function sessionIdCreatedAt(sessionId: string): string | null {
  const m = SESSION_ID_TS_RE.exec(sessionId);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
