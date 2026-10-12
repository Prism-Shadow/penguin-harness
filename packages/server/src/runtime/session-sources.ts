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
 * its source. Two clients are written by the server alone, each for one source: the organization
 * runtime opens only company Sessions under its `org` client (a desk opened at a hire can wait
 * days for its first run; the children its Sessions spawn run, and so record their own source,
 * at once), and the Agent API opens only `api` Sessions under its `api` client. Such a row reads
 * as that source, and the loader rebuilds it as one. Any other row stays unclassified until its
 * first run records a source.
 */
export function unrunSource(client: SessionRow["client"]): SessionSource | undefined {
  if (client === "org") return "company";
  return client === "api" ? "api" : undefined;
}

/**
 * The sources a program opens a Session for — the Agent API, a scheduled task's new-Session
 * run, `penguin run` — which the listing rule files away unless the user keeps them.
 */
export const BACKGROUND_SOURCES: ReadonlySet<SessionSource> = new Set(["api", "schedule", "cli"]);

/** The two marks on a Session's row the listing rule reads (SessionRow.archivedAt / keptAt). */
export interface ListingMarks {
  archivedAt: string | null;
  keptAt: string | null;
}

/** A row's marks, with the optional fields of an older-shaped row read as unset. */
export function listingMarksOf(row: {
  archivedAt?: string | null;
  keptAt?: string | null;
}): ListingMarks {
  return { archivedAt: row.archivedAt ?? null, keptAt: row.keptAt ?? null };
}

/**
 * Where a Session is listed — the listing rule, computed on every read, so nothing on disk is
 * ever rewritten to move a Session between lists:
 *
 * - none for a `company` Session (company mode's own views list it: a desk, a ticket's
 *   sessions) and for a `subagent` Session (its parent's Agent panel opens it), whatever their
 *   marks;
 * - `archived` when the user archived it;
 * - `archived` when a program opened it (BACKGROUND_SOURCES) and the user has not kept it;
 * - `active` otherwise — a person's conversation, a kept background Session, and a row whose
 *   Trace has not been read yet.
 *
 * The Web App applies the same rule to the rows it holds (`sessionCategory`, through the
 * effective `SessionInfo.archived`), so server filtering and client rendering never disagree.
 */
export function listCategory(
  source: SessionSource | undefined,
  marks: ListingMarks,
): SessionCategory | null {
  if (source === "company" || source === "subagent") return null;
  if (marks.archivedAt !== null) return "archived";
  if (source !== undefined && BACKGROUND_SOURCES.has(source) && marks.keptAt === null) {
    return "archived";
  }
  return "active";
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
