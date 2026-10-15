/**
 * Opt-in request-body inflate: a caller MAY send a JSON body `Content-Encoding: gzip`, and the
 * first middleware on `/api/*` inflates it back before any route reads it.
 *
 * Why: a draft chat has no Session, so file attachments ride the task request itself as base64
 * `data:` URLs (see task-attachments.ts) — and base64 inflates 4/3 on a body nothing compresses,
 * making the wire cost the binding constraint for exactly the files people attach (logs, CSVs,
 * JSON dumps, ten-to-one is ordinary). The composer gzips the whole serialized request when gzip
 * makes it smaller (see the web client's requestInit); this is the other half of that contract.
 * It is opt-in per request and changes no API shape, so non-browser callers are untouched, and a
 * request that arrives plain takes the same path as before.
 *
 * The two hard rules the hot-update channel learned (issue #521):
 *
 * - **The inflate is bounded.** `gunzipSync` runs with `maxOutputLength`, because a few hundred
 *   wire bytes of gzip must not decide how many gigabytes the process allocates. The bound is
 *   not a number of its own: it is `bodyLimitBytes` — the same derived cap a plain body is
 *   already subject to, itself computed from the admin-set attachment budget. A gzipped request
 *   whose inflated form would exceed it is one that could never have been sent plain, so the
 *   answer is the same `payload_too_large`/413 the body cap gives. The wire cap upstream still
 *   counts compressed bytes (it runs first and never sees the inflated form), which is why this
 *   bound, not that cap, is what actually limits memory.
 * - **Malformed gzip is a 400, not a crash.** A body that does not decompress never reaches a
 *   route, so no caller ever sees a JSON parse error for bytes that were never JSON.
 *
 * Only the exact coding `gzip` is claimed (case-insensitive; a comma list or any other coding
 * falls through and fails downstream JSON parsing as it does today). The raw body is read whole
 * because the byte cap upstream has already bounded it — every caller of this middleware mounts
 * it behind the bodyLimit middleware, and the inflate bound re-derives per request the same way
 * the cap does, so an admin's change takes effect on the next request.
 *
 * The swap follows hono's own bodyLimit precedent: `c.req.raw` is replaced with a fresh Request
 * carrying the inflated bytes. `content-encoding` is dropped from the forwarded headers so no
 * downstream consumer mistakes the now-plain body for coded bytes, and `content-length` with it
 * (undici sizes the new body itself).
 */
import zlib from "node:zlib";
import type { MiddlewareHandler } from "hono";
import { bodyLimitBytes } from "../services/attachment-limits.js";
import type { AttachmentLimitsMb } from "../services/attachment-limits.js";
import { HttpError, badRequest } from "./errors.js";

/** The `() =>` indirection keeps the middleware registration static while the limits stay per-request. */
export function gunzipRequestBody(getMb: () => AttachmentLimitsMb): MiddlewareHandler {
  return async (c, next) => {
    const encoding = c.req.header("content-encoding")?.trim().toLowerCase();
    if (encoding !== "gzip") return next();
    const wire = Buffer.from(await c.req.arrayBuffer());
    const maxInflated = bodyLimitBytes(getMb());
    let inflated: Buffer;
    try {
      inflated = zlib.gunzipSync(wire, { maxOutputLength: maxInflated });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new HttpError(
          413,
          "payload_too_large",
          `Request body inflates past the ${Math.floor(maxInflated / (1024 * 1024))}MB limit.`,
        );
      }
      throw badRequest("Request body is not valid gzip (Content-Encoding: gzip).");
    }
    const headers = new Headers(c.req.raw.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    c.req.raw = new Request(c.req.raw, {
      headers,
      body: inflated,
      duplex: "half",
    });
    await next();
  };
}
