/**
 * Image loading for read_file's image branch: which sources count as images, how their bytes
 * are fetched (an http(s) URL through the global fetch, anything else as a path resolved
 * against the Workspace), and the validation every image passes (size cap, supported mime).
 *
 * Detection order is magic number → response content-type (URLs only) → extension: a file
 * whose bytes say PNG is an image whatever it is called, and a `.png` path with unrecognized
 * bytes is still handed over as an image rather than dumped as text.
 */
import path from "node:path";
import { open, readFile, stat } from "node:fs/promises";

/**
 * Image size upper bound (bytes): errors out above this. Taken as the common denominator of
 * per-provider single-image hard limits (Claude API is around 5MB, some compatible endpoints are
 * lower) — since local validation passing but the next request getting a blanket 400 from the
 * provider is a non-retryable path, the limit must not exceed the strictest downstream; this also
 * avoids oversized images blowing up the context and Trace.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

/** Whether a source is an http(s) URL — the only kind of source that is never a local path. */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/**
 * Whether a local file is an image: judged by its leading bytes, then by its extension. A
 * file that cannot be opened is judged by extension alone — the caller's own read reports
 * the error afterwards.
 */
export async function looksLikeImageFile(filePath: string): Promise<boolean> {
  let fd;
  try {
    fd = await open(filePath, "r");
  } catch {
    return imageMimeFromExt(filePath) !== null;
  }
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fd.read(head, 0, SNIFF_BYTES, 0);
    return (
      sniffImageMime(head.subarray(0, bytesRead)) !== null || imageMimeFromExt(filePath) !== null
    );
  } catch {
    return imageMimeFromExt(filePath) !== null;
  } finally {
    await fd.close();
  }
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

const UNSUPPORTED_MESSAGE = (detected: string | null): string =>
  `Unsupported image type${detected ? ` "${detected}"` : ""}: only png, jpeg, gif and webp are supported.`;

/** Result of `loadImage`: success (bytes + mime) / interrupted / failed (explanatory message). */
export type LoadImageResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: "aborted" }
  | { ok: false; reason: "failed"; message: string };

/**
 * Reads and validates an image: an http(s) URL is downloaded with the global fetch, otherwise
 * read as a local path (resolved against Workspace); validates the size upper bound and mime
 * type (determined in order by response header / magic number / extension). Never throws.
 */
export async function loadImage(
  source: string,
  workspaceDir: string,
  signal?: AbortSignal,
): Promise<LoadImageResult> {
  if (signal?.aborted) return { ok: false, reason: "aborted" };

  let bytes: Buffer;
  let mime: string | null;
  if (isHttpUrl(source)) {
    // URL branch: downloads via the global fetch (abort signal passed through to the request);
    // mime is preferentially taken from the response header, falling back to magic number / URL
    // extension.
    let res: Response;
    try {
      res = await fetch(source, signal ? { signal } : {});
    } catch (err) {
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: "failed",
        message: `Failed to download image "${source}": ${message}`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "failed",
        message: `Failed to download image "${source}": HTTP ${res.status}`,
      };
    }
    // When content-length is trustworthy, reject an oversized response early to avoid reading it
    // into memory for nothing.
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      return { ok: false, reason: "failed", message: OVERSIZE_MESSAGE(declared) };
    }
    try {
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: "failed",
        message: `Failed to download image "${source}": ${message}`,
      };
    }
    const headerMime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
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
      const st = await stat(filePath);
      // Explicitly reject non-file paths such as directories: readFile's EISDIR error isn't
      // model-friendly.
      if (!st.isFile()) {
        return {
          ok: false,
          reason: "failed",
          message: `Failed to read image "${source}": path is not a file.`,
        };
      }
      if (st.size > MAX_IMAGE_BYTES) {
        return { ok: false, reason: "failed", message: OVERSIZE_MESSAGE(st.size) };
      }
      bytes = await readFile(filePath);
    } catch (err) {
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: "failed",
        message: `Failed to read image "${source}": ${message}`,
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
  return { ok: true, bytes, mime };
}
