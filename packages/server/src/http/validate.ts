/**
 * Hand-rolled request validation helpers. The general vocabulary lives in the http
 * package (`@prismshadow/penguin-library-http/validate`, services+http+cli restack T0)
 * and is re-exported here unchanged. This file keeps only the checks that speak the
 * Session domain's own types — those types belong to the server until the session slice
 * (S11) moves, and then go with it.
 */
import type { Context } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import {
  badRequest,
  optionalPagingQuery,
  parseNonNegativeInt,
} from "@prismshadow/penguin-library-http/validate";
import type {
  ActivityCursor,
  SessionListOrder,
  SessionListPaging,
} from "../services/session-service.js";
import { ADOPTED_AT_HEADER, listingViewOf } from "../runtime/session-sources.js";
import type { ListingView } from "../runtime/session-sources.js";

export {
  badRequest,
  pathParam,
  requireValidId,
  parseNonNegativeInt,
  positiveIntParam,
  paginationQuery,
  optionalPagingQuery,
  readJson,
  requireString,
  optionalString,
  optionalStringArray,
  requireProjectDir,
  requireEnum,
  optionalEnum,
  optionalNumber,
  optionalBoolean,
  optionalDateParam,
} from "@prismshadow/penguin-library-http/validate";
export type { StringRule, NumberRule } from "@prismshadow/penguin-library-http/validate";

/**
 * Who reads a Session list or row (session-sources.ts sourceSeenBy): a server that adopted this
 * one says when, and sees the Sessions held here before then as CLI tasks.
 */
export function listingViewOfRequest(c: Context): ListingView {
  return listingViewOf(c.req.header(ADOPTED_AT_HEADER));
}

/**
 * Parse an activity cursor, `<lastActiveAt>,<sessionId>`, or null when the text is not one.
 * Split at the FIRST comma — an ISO stamp holds none and a valid id holds none, so the split is
 * unambiguous; the stamp must parse as a date and the id must be a valid id. The stamp is kept
 * as sent: the list compares it as a string against the rows' own stamps, which is where the
 * client read it from.
 */
export function parseActivityCursor(raw: string): ActivityCursor | null {
  const comma = raw.indexOf(",");
  if (comma === -1) return null;
  const lastActiveAt = raw.slice(0, comma);
  const sessionId = raw.slice(comma + 1);
  if (Number.isNaN(Date.parse(lastActiveAt)) || !isValidId(sessionId)) return null;
  return { lastActiveAt, sessionId };
}

/**
 * The Session list's OPTIONAL paging: {@link optionalPagingQuery}'s offset form, or — under
 * `order=activity` — the cursor form `before=<lastActiveAt>,<sessionId>&limit=N`, which serves
 * the rows strictly below the cursor. A cursor in another order, beside an offset or without a
 * limit is a 400, never a silently different page.
 */
export function optionalSessionListPagingQuery(
  c: Context,
  order: SessionListOrder,
): SessionListPaging | null {
  const rawBefore = c.req.query("before");
  if (rawBefore === undefined) return optionalPagingQuery(c);
  if (order !== "activity") throw badRequest("before requires order=activity.");
  if (c.req.query("offset") !== undefined) throw badRequest("before and offset are exclusive.");
  const rawLimit = c.req.query("limit");
  if (rawLimit === undefined) throw badRequest("before requires limit.");
  const before = parseActivityCursor(rawBefore);
  if (!before) throw badRequest("before must be <lastActiveAt>,<sessionId>.");
  return { before, limit: limitQuery(rawLimit) };
}

/** Parse the Session list's required limit (1-1000); see the http package's limitQuery. */
function limitQuery(raw: string): number {
  const v = parseNonNegativeInt(raw);
  if (v === null || v < 1 || v > 1000) {
    throw badRequest("limit must be an integer between 1 and 1000.");
  }
  return v;
}
