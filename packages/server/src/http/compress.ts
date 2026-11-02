/**
 * gzip for the JSON an answer carries, when the caller asks for it.
 *
 * The company surface's JSON grew past what a forwarded hop likes: a roadmaps list was close
 * to a megabyte, and the ssh kind's tunnel carried every byte of it. A browser asks for gzip on
 * every request; this is where its `Accept-Encoding` is finally answered.
 *
 * The scope is deliberately narrow, so nothing that streams is caught in it:
 *
 * - GET answers of 200 whose content type is JSON, and nothing else. The streaming answers
 *   (an SSE feed, a proxied machine, a download) are either not JSON or not buffered; a
 *   response that is already encoded is left as it is.
 * - Not the machine proxy (`/server/…`): it relays the machine's own answer, headers and
 *   bytes as they are, and the machine — which owns the route — is the one that decides.
 * - Only bodies that declare themselves worth it (at least `MIN_BYTES`); a two-line error
 *   answer costs more to compress than it saves.
 *
 * The compression itself runs in the libuv thread pool (`zlib.gzip`, `zlib.zstdCompress`),
 * never on the event loop, so a big answer does not become a stall for everything else this
 * server is doing. A caller that accepts zstd gets it in preference: gzip on the company
 * surface's JSON bottoms out well above what the surface wants to carry, and zstd's top level
 * is what crosses under it; a Node without zstd, or a caller that never heard of it, gets gzip.
 */
import * as zlib from "node:zlib";
import { promisify } from "node:util";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth/middleware.js";

const gzipAsync = promisify(zlib.gzip) as (bytes: Uint8Array) => Promise<Buffer>;

/** Node's zstd is young: it may be absent, and its typings are not in every @types/node. */
type ZstdCompress = (
  data: Buffer,
  options: { params: Record<number, number> },
  callback: (err: Error | null, packed: Buffer) => void,
) => void;
const zstdCompress = (zlib as unknown as { zstdCompress?: ZstdCompress }).zstdCompress;
const zstdLevel = (zlib.constants as unknown as { ZSTD_c_compressionLevel?: number })
  .ZSTD_c_compressionLevel;
/** The one packer to reach for when the caller accepts zstd; null where Node has none. */
const packZstd: ((bytes: Uint8Array) => Promise<Buffer>) | null =
  zstdCompress !== undefined && zstdLevel !== undefined
    ? (bytes) =>
        new Promise<Buffer>((resolve, reject) =>
          zstdCompress(Buffer.from(bytes), { params: { [zstdLevel]: 19 } }, (err, packed) =>
            err === null ? resolve(packed) : reject(err),
          ),
        )
    : null;

/** Below this a body answers as it is: compression would cost more than it carries. */
const MIN_BYTES = 2048;

export function compressJson(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const res = c.res;
    const accepts = (c.req.header("accept-encoding") ?? "").toLowerCase();
    const useZstd = accepts.includes("zstd") && packZstd !== null;
    if (
      c.req.method !== "GET" ||
      res.status !== 200 ||
      !(res.headers.get("content-type") ?? "").startsWith("application/json") ||
      res.headers.has("content-encoding") ||
      // The proxy relays; the machine that owns the route decides the encoding.
      c.req.path.startsWith("/server/") ||
      !(useZstd || accepts.includes("gzip"))
    ) {
      return;
    }
    if (res.body === null) return;
    // From here on the original body is consumed: every path has to hand the adapter a fresh
    // response, because the one it holds a reader to is the locked original, unreadable now.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    if (bytes.byteLength < MIN_BYTES) {
      c.res = new Response(bytes, { status: res.status, headers });
      return;
    }
    try {
      const packed = useZstd ? await packZstd(bytes) : await gzipAsync(bytes);
      headers.set("content-encoding", useZstd ? "zstd" : "gzip");
      headers.set("content-length", String(packed.byteLength));
      headers.append("vary", "Accept-Encoding");
      c.res = new Response(packed, { status: res.status, headers });
    } catch {
      // Not compressible for a reason of zlib's own: the answer stands, as it was.
      c.res = new Response(bytes, { status: res.status, headers });
    }
  };
}
