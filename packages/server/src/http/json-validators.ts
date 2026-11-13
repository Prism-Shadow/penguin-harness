/**
 * A validator on every JSON read this server answers, and a 304 for a caller who already holds
 * the answer.
 *
 * Why it exists: a hub reads a machine's answers over an ssh link that may carry ten kilobytes a
 * second, and opening a conversation there asked for the same three answers (the models, the
 * Agent's Skills, the Agent's config — about 140 KB) on every open. The hub keeps the last one it
 * relayed (machines/answer-cache.ts) and asks with `If-None-Match`; an unchanged answer then
 * crosses as a 304 of a few hundred bytes instead of its whole body. Nothing is answered from a
 * clock: each read is still asked, so a change shows on the next read and never later.
 *
 * The ETag is the answer's own bytes, hashed with their content type: the same answer always
 * carries the same tag, a different one never does (short of a SHA-256 collision), and nothing
 * has to remember anything between requests. It is weak (`W/`) because the bytes on the wire
 * vary with the encoding (json-compression.ts) while the answer does not. A route that sets an
 * ETag of its own keeps it; this only compares the caller's `If-None-Match` against it.
 *
 * Only GET answers of 200 with a JSON body: an error is not something to keep, and a stream, a
 * download or a page is not JSON.
 */
import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { isJsonAnswer, replaceAnswer } from "./json-answer.js";

/** The weak ETag of one JSON answer: its content type and bytes, hashed. */
export function jsonEtag(contentType: string, body: Uint8Array): string {
  const hash = createHash("sha256").update(contentType).update("\n").update(body);
  return `W/"${hash.digest("base64url").slice(0, 22)}"`;
}

/**
 * Whether `If-None-Match` names `etag`, by RFC 9110's weak comparison: the header is a list, and
 * `W/"x"` and `"x"` are the same tag. `*` matches any answer that exists.
 */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  const want = bare(etag);
  return header.split(",").some((tag) => bare(tag) === want);
}

/** The headers a 304 does not carry: they describe a body it does not have. */
const BODY_HEADERS = ["content-type", "content-length", "content-encoding", "transfer-encoding"];

export function jsonValidators(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const res = c.res;
    if (c.req.method !== "GET" || res.status !== 200 || res.body === null) return;
    // An answer already encoded is somebody else's bytes to vouch for.
    if (!isJsonAnswer(res.headers) || res.headers.has("content-encoding")) return;
    let etag = res.headers.get("etag");
    let answer = res;
    if (etag === null) {
      const body = new Uint8Array(await res.arrayBuffer());
      etag = jsonEtag(res.headers.get("content-type") ?? "", body);
      const headers = new Headers(res.headers);
      headers.set("etag", etag);
      // The original's body is read: what goes on is a fresh answer over the same bytes.
      answer = new Response(body, { status: 200, headers });
      replaceAnswer(c, answer);
    }
    if (!ifNoneMatchHits(c.req.header("if-none-match"), etag)) return;
    const headers = new Headers(answer.headers);
    for (const name of BODY_HEADERS) headers.delete(name);
    await answer.body?.cancel().catch(() => undefined);
    replaceAnswer(c, new Response(null, { status: 304, headers }));
  };
}
