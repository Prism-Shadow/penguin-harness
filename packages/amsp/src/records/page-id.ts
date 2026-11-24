/**
 * Page ids: the id an Agent Workbench page holds, and how a reader tells one from the rest.
 *
 * A page id is shaped like a Session id (`page-YYYY-MM-DD-HH-mm-ss-<8 hex>`, local timezone) and
 * rides `session_meta.source` as a {@link PageSource}: a Session a workbench page opened records
 * that page's id as its source, so the tree of Sessions one page opened is read from the Traces
 * alone. The alphabet is the one a Session id and a Trace-file name already use
 * (`[A-Za-z0-9_-]`), so a page id can name a folder beside the workbench it belongs to.
 */
import type { PageSource } from "./types.js";

/** The prefix every page id carries, as {@link PageSource}'s own spelling says. */
export const PAGE_ID_PREFIX = "page-";

/**
 * Whether `value` is a page id: the runtime half of {@link PageSource}.
 *
 * Deliberately narrow — the prefix, then only the characters a Session id is made of — because
 * what it lets through is written into `session_meta.source`, which every reader of a Trace sees
 * and every Session listing compares; a value that merely starts with `page-` but carries junk
 * (a path separator, a space, a newline) is no page id and stays a person's conversation.
 */
export function isPageSource(value: unknown): value is PageSource {
  return (
    typeof value === "string" &&
    value.length > PAGE_ID_PREFIX.length &&
    value.length <= 128 &&
    value.startsWith(PAGE_ID_PREFIX) &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
