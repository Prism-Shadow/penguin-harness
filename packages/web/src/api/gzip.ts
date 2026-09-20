/**
 * Opt-in whole-request gzip for attachment-bearing API calls (#521).
 *
 * The JSON API shape is unchanged: when compression is worthwhile the request goes out
 * with the same `Content-Type: application/json` plus `Content-Encoding: gzip`, which the
 * server inflates before parsing. Non-browser callers send nothing different.
 *
 * Every exit returns null (send plain JSON) unless compression strictly pays:
 * - bodies under MIN_GZIP_BYTES skip the async compression pass entirely;
 * - a result that is not smaller than the input is discarded (a `.zip`, `.mp4`, or `.jpg`
 *   comes out slightly larger, and paying to add bytes is worth nothing);
 * - an unavailable or failing CompressionStream falls back silently, so older browsers
 *   behave exactly as before.
 */

/** Bodies below this size are never worth a compression pass. */
export const MIN_GZIP_BYTES = 1024;

function compressionStream(): CompressionStream | null {
  try {
    if (typeof CompressionStream === "undefined") return null;
    return new CompressionStream("gzip");
  } catch {
    return null;
  }
}

/**
 * Gzip `jsonText` when the result is strictly smaller, else null. Never throws: any
 * failure means the caller sends the plain body.
 */
export async function gzipIfBeneficial(jsonText: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const input = new TextEncoder().encode(jsonText);
    if (input.length < MIN_GZIP_BYTES) return null;
    const stream = compressionStream();
    if (stream === null) return null;
    const view = new Uint8Array(
      await new Response(new Blob([input]).stream().pipeThrough(stream)).arrayBuffer(),
    );
    // A fresh ArrayBuffer-backed copy: a view over a shared buffer does not satisfy
    // BlobPart/BodyInit, which require ArrayBuffer-backed views.
    const compressed = new Uint8Array(view.byteLength);
    compressed.set(view);
    if (compressed.length >= input.length) return null;
    return compressed;
  } catch {
    return null;
  }
}
