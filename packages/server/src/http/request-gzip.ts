/**
 * Whole-request gzip for attachment-bearing JSON requests (#521).
 *
 * A draft chat has no Session yet, so file attachments ride the task (or steer) request
 * itself as base64 `data:` URLs, and base64 inflates by 4/3. The web composer may instead
 * send the identical JSON body gzipped with `Content-Encoding: gzip`, keeping
 * `Content-Type: application/json` and the API shape unchanged, so non-browser callers
 * pay nothing and change nothing.
 *
 * Two bounds, both derived from the CURRENT per-request admin attachment budget (see
 * services/attachment-limits.ts), never a number of their own:
 * - compressed input: the existing `/api/*` bodyLimit middleware counts wire bytes, so a
 *   gzipped body is capped before this module ever sees it;
 * - inflated output: `maxInflatedBytes` below, enforced DURING decompression via
 *   `maxOutputLength`. Without it a few hundred kilobytes of gzip decide how many
 *   gigabytes the process allocates (the defect #426 fixed on the hot-update channel,
 *   whose `gunzipSync` calls carry no such bound; do not copy that shape).
 *
 * Decoding happens here, before JSON parsing and before any attachment is validated or
 * written: a malformed, unsupported, or oversized payload is refused before the first
 * scratchpad write, so there is never a partial batch to clean up.
 */
import zlib from "node:zlib";
import type { Context } from "hono";
import { HttpError } from "./errors.js";
import { badRequest, readJson } from "./validate.js";

/** The only request content coding this server inflates. Anything else is a 415. */
const GZIP_CODING = "gzip";
/** Explicit identity behaves like an absent header: the ordinary JSON path. */
const IDENTITY_CODING = "identity";

function requestCodings(c: Context): string[] {
  const raw = c.req.header("content-encoding");
  if (raw === undefined || raw === null) return [];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

function parseJsonObject(text: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export interface JsonRequestOptions {
  /**
   * Cap on the inflated body in bytes, derived per request from the admin attachment
   * budget (bodyLimitBytes): the largest body an equivalent uncompressed request could
   * carry. Enforced during decompression, not after it.
   */
  maxInflatedBytes: number;
}

/**
 * Read a JSON object request body, inflating `Content-Encoding: gzip` first.
 *
 * No header (or explicit `identity`) takes the exact historical path, so ordinary JSON
 * clients observe no change. A single `gzip` coding is inflated under `maxInflatedBytes`
 * and then parsed with the same errors as the plain path; anything else (deflate, br,
 * stacked codings) is a 415; corrupt gzip is a 400; an inflated body past the bound is a
 * 413. Auth, CSRF gating, and attachment validation all run exactly where they do for
 * plain requests. This only changes what bytes the JSON parser sees.
 */
export async function readJsonRequest(
  c: Context,
  opts: JsonRequestOptions,
): Promise<Record<string, unknown>> {
  const codings = requestCodings(c);
  if (codings.length === 0 || (codings.length === 1 && codings[0] === IDENTITY_CODING)) {
    return readJson(c);
  }
  if (codings.length !== 1 || codings[0] !== GZIP_CODING) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Request Content-Encoding must be gzip or absent.",
    );
  }
  const raw = Buffer.from(await c.req.arrayBuffer());
  let inflated: Buffer;
  try {
    inflated = zlib.gunzipSync(raw, { maxOutputLength: opts.maxInflatedBytes });
  } catch (err) {
    if (
      err instanceof RangeError ||
      (err as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new HttpError(
        413,
        "payload_too_large",
        `Inflated request body exceeds the ${Math.floor(opts.maxInflatedBytes / (1024 * 1024))}MB limit.`,
      );
    }
    throw badRequest("Request body must be valid gzip.");
  }
  return parseJsonObject(inflated.toString("utf8"));
}
