/**
 * What the two rules over this server's JSON answers (json-validators.ts, json-compression.ts)
 * share: which answers they are about, and how an answer is swapped for another.
 */
import type { Context } from "hono";
import { mediaType } from "./media-type.js";

/** An answer whose whole body is one JSON document: `application/json`, parameters aside. */
export function isJsonAnswer(headers: Headers): boolean {
  return mediaType(headers.get("content-type") ?? undefined)?.essence === "application/json";
}

/**
 * Hands the adapter `res` instead of the answer it holds. Assigning `c.res` alone copies every
 * header of the old answer onto the new one (Hono's setter), so a header deliberately left out —
 * a 304's content type, a re-encoded body's length — would come back; clearing first does not.
 */
export function replaceAnswer(c: Context, res: Response): void {
  c.res = undefined;
  c.res = res;
}
