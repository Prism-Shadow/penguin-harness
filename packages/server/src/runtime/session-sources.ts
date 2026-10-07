/**
 * In-process registry of Session sources, derived from core `session_meta` — the single
 * source of truth for what kind of conversation a Session is (the DB stores no `source`
 * column).
 *
 * Populated wherever the server actually has the meta in hand: Session creation
 * (SessionService reads the just-created core Session's meta), subagent registration
 * (SessionManager reads the forwarded child meta), forks (always `user`), and Trace adoption /
 * lazy list resolution (the trace index's head read). Every value is narrowed through core's
 * `normalizeSessionSource` before it lands here, so an old Trace's missing source reads as
 * `user` and its `benchmark` as `cli`. An absent entry means "unknown": the list path resolves
 * it from the Trace once per process lifetime.
 */
import type { SessionCategory, SessionSource } from "../api/types.js";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { SessionOrigins } from "../mechanisms/sessions.js";

/**
 * Where an unarchived Session is listed: a person's conversation (`user`, or a row not yet
 * classified) is `active`; every other source — API, scheduled, subagent and CLI Sessions — is
 * `background`. Archived wins over both, and the callers check it first. The Web App's sidebar
 * applies the same rule to loaded rows (`sessionCategory`), so server filtering and client
 * rendering never disagree.
 */
export function sourceCategory(
  source: SessionSource | undefined,
): Exclude<SessionCategory, "archived"> {
  return source === undefined || source === "user" ? "active" : "background";
}

@Component()
export class SessionSources implements SessionOrigins {
  private readonly map = new Map<string, SessionSource>();

  /** Records a Session's source as read from session_meta. */
  set(sessionId: string, source: SessionSource): void {
    this.map.set(sessionId, source);
  }

  /** The Session's known source; `undefined` when this process has not seen its meta. */
  get(sessionId: string): SessionSource | undefined {
    return this.map.get(sessionId);
  }

  /** Drops a deleted Session's entry (bulk Agent/Project deletion may leave stale entries; they are never matched again). */
  delete(sessionId: string): void {
    this.map.delete(sessionId);
  }
}
