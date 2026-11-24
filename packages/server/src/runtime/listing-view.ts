/**
 * Who is reading a Session list, as far as the listing rule cares (library/trace listing.ts
 * `sourceSeenBy`), and how a request says so. The rule itself (the header name, the view, and
 * its parse) lives in the trace domain package (@prismshadow/penguin-library-trace/listing,
 * services+http+cli restack S9); this module re-exports it for the server's own import paths —
 * kept nameable here, so a code plugin that lists Sessions through the listing rule reaches it
 * through the plugin face without bundling the session runtime — and adds the hono request view.
 */
import type { Context } from "hono";
import {
  ADOPTED_AT_HEADER,
  listingViewOf,
  type ListingView,
} from "@prismshadow/penguin-library-trace/listing";

export { ADOPTED_AT_HEADER, listingViewOf };
export type { ListingView };

/**
 * Who reads a Session list or row: a server that adopted this one says when, and sees the
 * Sessions held here before then as CLI tasks.
 */
export function listingViewOfRequest(c: Context): ListingView {
  return listingViewOf(c.req.header(ADOPTED_AT_HEADER));
}
