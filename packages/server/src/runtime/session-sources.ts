/**
 * In-process registry of Session sources, derived from core `session_meta` — the single
 * source of truth for what kind of conversation a Session is (the DB stores no `source`
 * column).
 *
 * Populated wherever the server actually has the meta in hand: Session creation
 * (SessionService reads the just-created core Session's meta), subagent registration
 * (SessionManager reads the forwarded child meta), forks (always `user`), and Trace adoption /
 * lazy list resolution (the trace index's head read). A value read back from a Trace is
 * narrowed through core's `normalizeSessionSource` (the retired `benchmark` reads as `cli`),
 * except that a head recording no source is kept as `null`: what it reads as depends on the
 * Session's index row (`readRecordedSource`), which a head read does not have. An absent entry
 * means "unknown": the list path resolves it from the Trace once per process lifetime.
 */
import type { SessionCategory, SessionSource } from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { SessionOrigins } from "../mechanisms/sessions.js";

/**
 * What a Session's Trace head records as its source: one of the sources, or `null` for a head
 * written before the source was required, which records none.
 */
export type RecordedSource = SessionSource | null;

/**
 * A Session's source, from what its Trace head records and the client its index row names.
 * A recorded source is the answer. A head that records none was written before the source was
 * required, when company mode's desk and ticket Sessions recorded none either; the organization
 * runtime stamps those rows `client = "org"`, so such a row reads as `company`, and every other
 * one as `user`, the reading core's `normalizeSessionSource` gives a missing source.
 */
export function readRecordedSource(
  recorded: RecordedSource,
  client: SessionRow["client"],
): SessionSource {
  if (recorded !== null) return recorded;
  // compat(0.3.0): a head from before the source was required. It goes with core's missing →
  // `user` branch (see normalizeSessionSource), and a one-time rewrite of old heads, if that is
  // what replaces it, writes `company` for these rows.
  return client === "org" ? "company" : "user";
}

/**
 * The source of a Session that has not run yet, read from its index row. Its session_meta is
 * written by its first run, so once the process that created it is gone nothing on disk names
 * its source. The organization runtime opens only company Sessions under its `org` client (a
 * desk opened at a hire can wait days for its first run; the children its Sessions spawn run,
 * and so record their own source, at once), so such a row is `company`, and the loader rebuilds
 * it as one. Any other row stays unclassified until its first run records a source.
 */
export function unrunSource(client: SessionRow["client"]): SessionSource | undefined {
  return client === "org" ? "company" : undefined;
}

/**
 * The list category of a Session: none for a `company` Session, which only company mode's
 * own views list (an employee's desk, a ticket's sessions), whether archived or not; otherwise
 * archived first, then a person's conversation (`user`, or a row not yet classified) is
 * `active` and every other source — API, scheduled, subagent and CLI Sessions — `background`.
 * The Web App's sidebar applies the same rule to loaded rows (`sessionCategory`), so server
 * filtering and client rendering never disagree.
 */
export function listCategory(
  source: SessionSource | undefined,
  archived: boolean,
): SessionCategory | null {
  if (source === "company") return null;
  if (archived) return "archived";
  return source === undefined || source === "user" ? "active" : "background";
}

@Component()
export class SessionSources implements SessionOrigins {
  private readonly map = new Map<string, RecordedSource>();

  /** Records a Session's source as read from session_meta (`null`: a head that records none). */
  set(sessionId: string, source: RecordedSource): void {
    this.map.set(sessionId, source);
  }

  /**
   * What the Session's meta records: a source, `null` for a head that records none (read it
   * through `readRecordedSource`), `undefined` when this process has not seen the meta.
   */
  get(sessionId: string): RecordedSource | undefined {
    return this.map.get(sessionId);
  }

  /** Drops a deleted Session's entry (bulk Agent/Project deletion may leave stale entries; they are never matched again). */
  delete(sessionId: string): void {
    this.map.delete(sessionId);
  }
}
