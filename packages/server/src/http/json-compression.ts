/**
 * JSON answers compressed for a caller that asks for it (`Accept-Encoding`).
 *
 * Why it exists: a hub reads a machine's answers over an ssh link that may carry ten kilobytes a
 * second, and those answers crossed it as plain JSON — this server compressed its static files
 * only. Opening a conversation there brought the models (56–76 KB), the Agent's Skills (22 KB)
 * and its config (55 KB) every time; the three shrink to about a seventh with brotli. The hub
 * asks for `br, gzip` on every request it forwards and decodes before relaying
 * (machines/answer-decoding.ts); a browser asking over HTTP is answered by the same rule.
 *
 * - Only JSON, and only from 1 KiB: below that the encoding's own overhead eats the gain, and the
 *   bytes were never the cost.
 * - Brotli where accepted, gzip otherwise, and `q=0` is a refusal: a caller that sent
 *   `gzip;q=0` said "not gzip", which a substring match would read as consent.
 * - Brotli at quality 6: on these answers it is 5–11 % smaller than gzip at the same speed (well
 *   under a millisecond each), while quality 9 takes ten times as long for 1–3 % less and 11 a
 *   hundred times as long for 10–16 % less. Both run in the thread pool, off the event loop.
 * - An answer that is already encoded is left as it is.
 */
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { isJsonAnswer, replaceAnswer } from "./json-answer.js";

/** Below this, an answer goes as it is. */
export const COMPRESS_MIN_BYTES = 1024;

const BROTLI_QUALITY = 6;

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** The encoding to answer a caller with, by its `Accept-Encoding`: brotli, gzip or none. */
export function pickEncoding(header: string | undefined): "br" | "gzip" | null {
  if (header === undefined) return null;
  const accepted = new Set<string>();
  for (const part of header.split(",")) {
    const [name = "", ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    const q = params.find((p) => p.startsWith("q="));
    if (name !== "" && (q === undefined || Number(q.slice(2)) > 0)) accepted.add(name);
  }
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return null;
}

function pack(body: Uint8Array, encoding: "br" | "gzip"): Promise<Buffer> {
  return encoding === "br"
    ? brotli(body, {
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
        },
      })
    : gzip(body, { level: 6 });
}

export function jsonCompression(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const res = c.res;
    if (res.body === null || !isJsonAnswer(res.headers) || res.headers.has("content-encoding"))
      return;
    const encoding = pickEncoding(c.req.header("accept-encoding"));
    if (encoding === null) return;
    const body = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    if (body.byteLength < COMPRESS_MIN_BYTES) {
      replaceAnswer(c, new Response(body, { status: res.status, headers }));
      return;
    }
    let packed: Buffer;
    try {
      packed = await pack(body, encoding);
    } catch {
      // zlib refused for a reason of its own: the answer goes as it was.
      replaceAnswer(c, new Response(body, { status: res.status, headers }));
      return;
    }
    headers.set("content-encoding", encoding);
    headers.delete("content-length");
    headers.append("vary", "Accept-Encoding");
    replaceAnswer(c, new Response(new Uint8Array(packed), { status: res.status, headers }));
  };
}
