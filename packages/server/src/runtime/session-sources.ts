/**
 * In-process registry of Session origins, derived from core `session_meta` — the single
 * source of truth for a Session's origin (the DB stores no `source` column).
 *
 * Populated wherever the server actually has the meta in hand: Session creation
 * (SessionService reads the just-created core Session's meta), subagent registration
 * (SessionManager reads the forwarded child meta), and Trace adoption / lazy list
 * resolution (SessionService reads the Trace head's session_meta). `null` records a
 * **known** user-created Session (meta seen, no source) so the Trace is not re-read on
 * every list; an absent entry means "unknown" and the list path resolves it from the
 * Trace once per process lifetime.
 */
import type { SessionSource } from "../api/types.js";

/**
 * Narrows an untrusted value (on-disk Trace JSON / forwarded meta) to a SessionSource:
 * only the exact known origins pass; anything else — including junk written by third
 * parties — is treated as absent rather than cast through.
 */
export function asSessionSource(v: unknown): SessionSource | undefined {
  return v === "schedule" || v === "subagent" ? v : undefined;
}

export class SessionSources {
  private readonly map = new Map<string, SessionSource | null>();

  /** Records a Session's origin as read from session_meta (`null` = meta seen, user-created). */
  set(sessionId: string, source: SessionSource | null): void {
    this.map.set(sessionId, source);
  }

  /** Known origin, `null` for a known user-created Session, `undefined` when this process has not seen the meta. */
  get(sessionId: string): SessionSource | null | undefined {
    return this.map.get(sessionId);
  }

  /** Drops a deleted Session's entry (bulk Agent/Project deletion may leave stale entries; they are never matched again). */
  delete(sessionId: string): void {
    this.map.delete(sessionId);
  }
}
