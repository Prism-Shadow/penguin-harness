/**
 * In-process registry of Session sources, derived from core `session_meta` — the single
 * source of truth for what kind of conversation a Session is (the DB stores no `source`
 * column). The listing rule and the source vocabulary moved to the trace domain package
 * (@prismshadow/penguin-library-trace/listing, services+http+cli restack S9); this file
 * keeps the registry component and re-exports the moved shapes for the server's own
 * import paths.
 */
import { Component } from "@prismshadow/penguin-core/kernel";
import type { SessionOrigins } from "@prismshadow/penguin-library-session";
import type { RecordedSource } from "@prismshadow/penguin-library-trace/listing";

export * from "@prismshadow/penguin-library-trace/listing";
// Who is reading a list, and the header a request says so with: their own module.
export { ADOPTED_AT_HEADER, listingViewOf } from "./listing-view.js";
export type { ListingView } from "./listing-view.js";

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
