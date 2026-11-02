/**
 * The hub's half of the compressed leg to a machine: what it asks for, and how it reads back
 * what came.
 *
 * Every request the hub forwards to a machine (proxy.ts) asks for `br, gzip` in its own name —
 * never the caller's `Accept-Encoding`, which describes the caller's link, not this one — and
 * the answer is decoded here before it is relayed. Relaying the encoded bytes would only work for
 * a browser on HTTP that happened to accept the same encoding: an API socket call is framed as
 * parsed JSON (socket/serve.ts), and the hub's own answer to its caller is encoded by its own
 * rule (http/json-compression.ts), never twice.
 *
 * A machine whose server predates this answers as it always did, with no `Content-Encoding`, and
 * its answer is relayed untouched. One in an encoding this side did not ask for is left as it
 * is too, header and all, rather than guessed at.
 */
import type http from "node:http";
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

/** What the hub asks a machine for on every forwarded request. */
export const ASKED_ENCODINGS = "br, gzip";

type Decoder = () => zlib.Gunzip | zlib.BrotliDecompress | zlib.Inflate;

const DECODERS: Record<string, Decoder> = {
  br: () => zlib.createBrotliDecompress(),
  gzip: () => zlib.createGunzip(),
  "x-gzip": () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
};

/** The machine's encoding when this side can undo it; null for none, or one it cannot. */
export function decodableEncoding(res: http.IncomingMessage): string | null {
  const encoding = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
  return encoding in DECODERS ? encoding : null;
}

/**
 * The answer's body as the machine meant it: decoded when it came encoded in a way this side
 * undoes, the stream itself otherwise. A body that fails to decode ends the stream with the
 * error, as a dropped connection would.
 */
export function decodedBody(res: http.IncomingMessage): Readable {
  const encoding = decodableEncoding(res);
  if (encoding === null) return res;
  const out = new PassThrough();
  pipeline(res, DECODERS[encoding]!(), out).catch((err: unknown) => {
    out.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  return out;
}
