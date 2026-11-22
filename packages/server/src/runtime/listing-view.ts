/**
 * Who is reading a Session list, as far as the listing rule cares (session-sources.ts
 * `sourceSeenBy`), and how a request says so. Its own module, importing nothing at run time, so a
 * code plugin that lists Sessions through the listing rule reaches it through the plugin face
 * without bundling the session runtime.
 */
import type { Context } from "hono";

/**
 * The request header a server that adopted this one as a machine sends with every call it makes
 * here (its `/server/<id>` proxy and its own calls): the time it adopted this server, ISO.
 */
export const ADOPTED_AT_HEADER = "x-penguin-adopted-at";

/**
 * Who is reading a list, as far as the listing rule cares: a server that adopted this one as a
 * machine at `adoptedAt` (read from {@link ADOPTED_AT_HEADER}), or anyone else (`{}`).
 */
export interface ListingView {
  adoptedAt?: string;
}

/** The view a request asks for: its adoption time when the header carries a valid one. */
export function listingViewOf(header: string | undefined): ListingView {
  if (header === undefined || !Number.isFinite(Date.parse(header))) return {};
  return { adoptedAt: header };
}

/**
 * Who reads a Session list or row: a server that adopted this one says when, and sees the
 * Sessions held here before then as CLI tasks.
 */
export function listingViewOfRequest(c: Context): ListingView {
  return listingViewOf(c.req.header(ADOPTED_AT_HEADER));
}
