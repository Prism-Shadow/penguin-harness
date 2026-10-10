/**
 * Image loading for read_file's image branch: which sources count as images, how their bytes
 * are fetched (an http(s) URL through the global fetch, anything else as a path resolved
 * against the Workspace), and the validation every image passes (size cap, supported format).
 *
 * Two questions, settled by different evidence. Whether a source takes the image branch: an
 * http(s) URL always does, and a local file does when its leading bytes or its extension say
 * image — a file whose bytes say PNG is an image whatever it is called, and a `.png` path is
 * never dumped as text. Which format the image is: its bytes (magic number) alone. The
 * extension and a URL's content-type only say what the source claims to be, and the claim is
 * exactly what a renamed SVG, a HEIC photo saved as `.jpg` or an HTML error page served as
 * `image/png` gets wrong — handed to the provider under the claimed type, such an image gets
 * the whole request rejected. Bytes that are none of the supported formats are refused here,
 * naming what they look like when that is cheap to tell.
 */
import path from "node:path";
import { describeFsError, errorCode, localFsPort } from "./fs-port.js";
import type { FsPort } from "./fs-port.js";
import { formatSize } from "../../omnimessage/index.js";

/**
 * Image size upper bound (bytes): errors out above this. Taken as the common denominator of
 * per-provider single-image hard limits (Claude API is around 5MB, some compatible endpoints are
 * lower) — since local validation passing but the next request getting a blanket 400 from the
 * provider is a non-retryable path, the limit must not exceed the strictest downstream; this also
 * avoids oversized images blowing up the context and Trace.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Extension -> mime: routes a local file into the image branch, and names the type a source
 * declared when its bytes turn out to be no supported image. Never the format itself.
 */
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Bytes that decide every supported magic number (the WebP RIFF header is the longest). */
const SNIFF_BYTES = 12;

/**
 * Sniffs the mime type from the file header's magic number: one of the four formats generally
 * accepted across providers (png, jpeg, gif, webp), or null for anything else.
 */
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

/** ISO base media file brands of the HEIF family: HEIC photos (the iPhone default) and AVIF. */
const HEIF_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "avif", "mif1"]);

/** Bytes read to recognize markup (an SVG's root tag can sit behind an XML prolog). */
const MARKUP_PROBE_BYTES = 512;

/**
 * What bytes that are none of the supported formats look like, for the formats a file named
 * or served as an image most often turns out to be; null when none matches. It only shapes
 * the refusal's wording: a wrong guess costs a misleading hint, never a wrong decision.
 */
function describeUnsupportedBytes(buf: Buffer): string | null {
  const magic = buf.subarray(0, 4).toString("latin1");
  if (magic === "%PDF") return "PDF";
  if (magic === "II*\x00" || magic === "MM\x00*") return "TIFF";
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    if (HEIF_BRANDS.has(buf.subarray(8, 12).toString("latin1"))) return "HEIC/AVIF";
  }
  // "BM" alone opens plenty of text; the header's reserved field (always zero) pins it down.
  if (buf.length >= 14 && magic.startsWith("BM") && buf.readUInt32LE(6) === 0) return "BMP";
  // trimStart also drops a byte-order mark.
  const head = buf.subarray(0, MARKUP_PROBE_BYTES).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<!doctype svg")) return "SVG";
  if (head.startsWith("<?xml")) return head.includes("<svg") ? "SVG" : "XML";
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return "HTML";
  return null;
}

/** Infers the mime type from a path / URL pathname's extension; returns null if it can't be inferred. */
function imageMimeFromExt(p: string): string | null {
  return EXT_TO_MIME[path.extname(p).toLowerCase()] ?? null;
}

/** Whether a source is an http(s) URL — the only kind of source that is never a local path. */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/**
 * Whether a local file takes the image branch: judged by its leading bytes, then by its
 * extension (`loadImage` then holds the bytes to a supported format). A file that cannot be
 * opened is judged by extension alone — the caller's own read reports the error afterwards.
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

const OVERSIZE_MESSAGE = (size: number): string =>
  `Image too large: ${formatSize(size)} exceeds the ${formatSize(MAX_IMAGE_BYTES)} limit.`;

/**
 * The refusal for bytes that are none of the supported formats. The model reads it, and the
 * fix it can act on is converting the file, so it says what the bytes are when that was
 * recognized, else the type the source declared.
 */
const UNSUPPORTED_MESSAGE = (looksLike: string | null, declared: string | null): string => {
  const what = looksLike
    ? `the bytes are ${looksLike}, not png, jpeg, gif or webp`
    : `the bytes are not png, jpeg, gif or webp${declared ? ` (declared as ${declared})` : ""}`;
  return `Unsupported image type: ${what}. Convert it to PNG or JPEG first.`;
};

/** Result of `loadImage`: success (bytes + mime) / interrupted / failed (explanatory message). */
export type LoadImageResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: "aborted" }
  | { ok: false; reason: "failed"; message: string };

/**
 * Reads and validates an image: an http(s) URL is downloaded with the global fetch, otherwise
 * read as a local path (resolved against Workspace); validates the size upper bound and the
 * format, which the bytes' magic number alone decides. Never throws.
 */
export async function loadImage(
  source: string,
  workspaceDir: string,
  signal?: AbortSignal,
  /** The file system (and network) to work through — the Session's sandboxed helper when confined (see fs-port.ts). */
  fs: FsPort = localFsPort,
  sandboxed = false,
): Promise<LoadImageResult> {
  if (signal?.aborted) return { ok: false, reason: "aborted" };

  let bytes: Buffer;
  // What the source claims to be (content-type, else extension): named in a refusal only.
  let declared: string | null;
  if (isHttpUrl(source)) {
    // URL branch: downloaded through the port (the abort signal passed through), capped at
    // the image limit — a declared or actual size beyond it is refused before the bytes are
    // kept.
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
      urlExtMime = null; // A URL parse failure only loses the extension from a refusal
    }
    declared = headerMime || urlExtMime;
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
    declared = imageMimeFromExt(filePath);
  }

  if (signal?.aborted) return { ok: false, reason: "aborted" };
  // Empty file/response: said so plainly rather than refused as an unrecognized format.
  if (bytes.length === 0) {
    return { ok: false, reason: "failed", message: `Image "${source}" is empty.` };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "failed", message: OVERSIZE_MESSAGE(bytes.length) };
  }
  const mime = sniffImageMime(bytes);
  if (mime === null) {
    return {
      ok: false,
      reason: "failed",
      message: UNSUPPORTED_MESSAGE(describeUnsupportedBytes(bytes), declared),
    };
  }
  return { ok: true, bytes, mime };
}
