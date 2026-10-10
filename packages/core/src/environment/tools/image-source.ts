/**
 * Image loading for read_file's image branch: which sources count as images, how their bytes
 * are fetched (an http(s) URL through the global fetch, anything else as a path resolved
 * against the Workspace), and the validation every image passes (size cap, supported mime,
 * pixel dimensions).
 *
 * Detection order is magic number → response content-type (URLs only) → extension: a file
 * whose bytes say PNG is an image whatever it is called, and a `.png` path with unrecognized
 * bytes is still handed over as an image rather than dumped as text.
 */
import path from "node:path";
import { describeFsError, errorCode, localFsPort } from "./fs-port.js";
import type { FsPort } from "./fs-port.js";

/**
 * Image size upper bound (bytes): errors out above this. Taken as the common denominator of
 * per-provider single-image hard limits (Claude API is around 5MB, some compatible endpoints are
 * lower) — since local validation passing but the next request getting a blanket 400 from the
 * provider is a non-retryable path, the limit must not exceed the strictest downstream; this also
 * avoids oversized images blowing up the context and Trace.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Image dimension upper bound as a longest side (px), the conservative default applied when
 * the session model names no per-model cap: providers enforce such a cap on image input and
 * answer an image over it with a blanket 400 that reports a format problem (DeepSeek draws
 * the line at 8192 px on the longest side, issue #944) — and since a fatal tool result is
 * replayed with every later request, that 400 would recur forever. An image that fits under
 * this default is accepted everywhere a wider cap would also accept it; a model (or catalog
 * row) with a different cap pins its own (EnvironmentServices.maxImageSide).
 */
export const MAX_IMAGE_SIDE = 8192;

/** Supported image mime types (the four generally accepted across providers). */
const SUPPORTED_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Extension -> mime (fallback when magic-number sniffing fails). */
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Bytes that decide every supported magic number (the WebP RIFF header is the longest). */
const SNIFF_BYTES = 12;

/** Sniffs the mime type from the file header's magic number; returns null if unrecognized. */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Infers the mime type from a path / URL pathname's extension; returns null if it can't be inferred. */
function imageMimeFromExt(p: string): string | null {
  return EXT_TO_MIME[path.extname(p).toLowerCase()] ?? null;
}

/** Pixel dimensions as read from an image header. */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Reads an image's pixel dimensions from its header alone (every supported format stores
 * them in its first bytes): PNG's IHDR, JPEG's first SOFn frame header (walking the marker
 * segments to reach it), GIF's logical screen descriptor, and WebP's VP8 / VP8L / VP8X
 * chunk. Returns null when the bytes carry no recognizable header of their declared format —
 * a caller refusing on dimensions then simply has no basis to.
 */
export function parseImageDimensions(buf: Buffer): ImageDimensions | null {
  // PNG: signature, then the mandatory first chunk IHDR — big-endian width/height at 16..24.
  if (
    buf.length >= 24 &&
    buf.readUInt32BE(0) === 0x89504e47 &&
    buf.readUInt32BE(12) === 0x49484452
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the marker segment chain to the first SOFn frame header (height/width
  // big-endian inside). Standalone markers (TEM, RSTn, SOI/EOI) carry no length field;
  // every other segment is skipped by its own, with a floor of 2 so a hostile header
  // cannot stall the walk.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 4 <= buf.length && buf[off] === 0xff) {
      const marker = buf[off + 1]!;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        off += 2;
        continue;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 && // DHT
        marker !== 0xc8 && // JPG
        marker !== 0xcc // DAC
      ) {
        if (off + 9 > buf.length) return null;
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + Math.max(2, buf.readUInt16BE(off + 2));
    }
    return null;
  }
  // GIF: the logical screen descriptor carries little-endian width/height at 6..10.
  if (buf.length >= 10) {
    const head = buf.subarray(0, 6).toString("latin1");
    if (head === "GIF87a" || head === "GIF89a") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
  }
  // WebP: a RIFF container whose first chunk names the flavor — VP8 (lossy: 14-bit
  // dimensions behind the 3-byte start code), VP8L (lossless: dimensions minus one,
  // bit-packed after the 0x2F signature), VP8X (extended: canvas dimensions minus one as
  // 24-bit little-endian).
  if (
    buf.length >= 30 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    const chunk = buf.subarray(12, 16).toString("latin1");
    if (chunk === "VP8 ") {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buf[20] === 0x2f) {
      const b1 = buf[21]!;
      const b2 = buf[22]!;
      return {
        width: 1 + (b1 | ((b2 & 0x3f) << 8)),
        height: 1 + ((b2 >> 6) | (buf[23]! << 2) | ((buf[24]! & 0x0f) << 10)),
      };
    }
    if (chunk === "VP8X") {
      return {
        width: 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)),
        height: 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)),
      };
    }
    return null;
  }
  return null;
}

/** Whether a source is an http(s) URL — the only kind of source that is never a local path. */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/**
 * Whether a local file is an image: judged by its leading bytes, then by its extension. A
 * file that cannot be opened is judged by extension alone — the caller's own read reports
 * the error afterwards.
 */
export async function looksLikeImageFile(
  filePath: string,
  fs: FsPort = localFsPort,
): Promise<boolean> {
  let head: Buffer;
  try {
    head = await fs.readRange(filePath, 0, SNIFF_BYTES);
  } catch {
    return imageMimeFromExt(filePath) !== null;
  }
  return sniffImageMime(head) !== null || imageMimeFromExt(filePath) !== null;
}

/** Byte count -> human-readable size (B / kB / MB, one decimal place). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} kB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const OVERSIZE_MESSAGE = (size: number): string =>
  `Image too large: ${formatSize(size)} exceeds the ${formatSize(MAX_IMAGE_BYTES)} limit.`;

const OVER_DIMENSIONS_MESSAGE = (width: number, height: number, maxSide: number): string =>
  `Image too large for this model: ${width}×${height} px exceeds the ${maxSide} px longest-side limit, so it is not attached. ` +
  `The endpoint would reject the request over it (and report a misleading format error). Downscale the image first (e.g. with a shell command) and read the smaller copy.`;

const UNSUPPORTED_MESSAGE = (detected: string | null): string =>
  `Unsupported image type${detected ? ` "${detected}"` : ""}: only png, jpeg, gif and webp are supported.`;

/** Result of `loadImage`: success (bytes + mime) / interrupted / failed (explanatory message). */
export type LoadImageResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: "aborted" }
  | { ok: false; reason: "failed"; message: string };

/**
 * Reads and validates an image: an http(s) URL is downloaded with the global fetch, otherwise
 * read as a local path (resolved against Workspace); validates the size upper bound, mime
 * type (determined in order by response header / magic number / extension), and pixel
 * dimensions against the longest-side cap. Never throws.
 */
export async function loadImage(
  source: string,
  workspaceDir: string,
  signal?: AbortSignal,
  /** The file system (and network) to work through — the Session's sandboxed helper when confined (see fs-port.ts). */
  fs: FsPort = localFsPort,
  sandboxed = false,
  /** Longest-side pixel cap (the session model's own when it names one, else MAX_IMAGE_SIDE). */
  maxImageSide = MAX_IMAGE_SIDE,
): Promise<LoadImageResult> {
  if (signal?.aborted) return { ok: false, reason: "aborted" };

  let bytes: Buffer;
  let mime: string | null;
  if (isHttpUrl(source)) {
    // URL branch: downloaded through the port (the abort signal passed through), capped at
    // the image limit — a declared or actual size beyond it is refused before the bytes are
    // kept; mime is preferentially taken from the response header, falling back to magic
    // number / URL extension.
    let res;
    try {
      res = await fs.fetch(source, { maxBytes: MAX_IMAGE_BYTES, ...(signal ? { signal } : {}) });
    } catch (err) {
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      if (errorCode(err) === "ETOOBIG") {
        return {
          ok: false,
          reason: "failed",
          message: OVERSIZE_MESSAGE((err as { size: number }).size),
        };
      }
      return {
        ok: false,
        reason: "failed",
        message: `Failed to download image "${source}": ${describeFsError(err, sandboxed)}`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "failed",
        message: `Failed to download image "${source}": HTTP ${res.status}`,
      };
    }
    bytes = res.bytes;
    const headerMime = (res.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    let urlExtMime: string | null = null;
    try {
      urlExtMime = imageMimeFromExt(new URL(source).pathname);
    } catch {
      urlExtMime = null; // A URL parse failure only affects the extension fallback
    }
    mime = SUPPORTED_MIMES.has(headerMime) ? headerMime : (sniffImageMime(bytes) ?? urlExtMime);
    if (mime === null && headerMime) mime = headerMime; // Include the real response type in the error
  } else {
    // Local-path branch: relative paths are resolved against Workspace; stat first to check the
    // size before reading, to avoid reading an oversized file into memory in one go.
    const filePath = path.resolve(workspaceDir, source);
    try {
      const st = await fs.stat(filePath);
      // Explicitly reject non-file paths such as directories: readFile's EISDIR error isn't
      // model-friendly.
      if (!st.isFile) {
        return {
          ok: false,
          reason: "failed",
          message: `Failed to read image "${source}": path is not a file.`,
        };
      }
      if (st.size > MAX_IMAGE_BYTES) {
        return { ok: false, reason: "failed", message: OVERSIZE_MESSAGE(st.size) };
      }
      bytes = await fs.readFile(filePath);
    } catch (err) {
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      return {
        ok: false,
        reason: "failed",
        message: `Failed to read image "${source}": ${describeFsError(err, sandboxed)}`,
      };
    }
    mime = sniffImageMime(bytes) ?? imageMimeFromExt(filePath);
  }

  if (signal?.aborted) return { ok: false, reason: "aborted" };
  // Empty file/response: magic-number sniffing fails to identify it, but the extension fallback
  // may still let it through — an empty base64 sent to the provider is guaranteed to error, so
  // reject it here.
  if (bytes.length === 0) {
    return { ok: false, reason: "failed", message: `Image "${source}" is empty.` };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "failed", message: OVERSIZE_MESSAGE(bytes.length) };
  }
  if (mime === null || !SUPPORTED_MIMES.has(mime)) {
    return { ok: false, reason: "failed", message: UNSUPPORTED_MESSAGE(mime) };
  }
  // Dimension guard: an image past the model's longest-side cap is refused here, with the
  // real reason, instead of being attached for the endpoint to 400 (a fatal tool result is
  // replayed with every later request, so nothing downstream could recover from it). Bytes
  // whose header parses to nothing — the extension fallback lets headerless content through
  // as an image — pass: there is no basis to refuse them.
  const dims = parseImageDimensions(bytes);
  if (dims !== null && Math.max(dims.width, dims.height) > maxImageSide) {
    return {
      ok: false,
      reason: "failed",
      message: OVER_DIMENSIONS_MESSAGE(dims.width, dims.height, maxImageSide),
    };
  }
  return { ok: true, bytes, mime };
}
