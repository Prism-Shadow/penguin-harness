/**
 * Automatic image compression: the composer's answer to a picture that is too big to sit in a
 * conversation comfortably.
 *
 * An inline image is not an attachment. An attachment goes to the Session scratchpad and is read
 * back by path, so its size is paid once; an image rides the conversation, is written verbatim
 * into the Trace JSONL, and that file is read back whole on every history page and every Session
 * resume. Refusing the picture was one way to keep that cost down. Shrinking it is the better
 * one: the user still sends what they meant to send, and the upload gets smaller too, because
 * the re-encode happens before the file is ever read into a base64 `data:` URL.
 *
 * The policy — whether this runs and above what size — is the server's, and arrives on `/api/me`
 * (see state/auth `uploadPolicy`). The decision is kept DOM-free here so it can be tested
 * directly; only `compressImage` touches the canvas.
 */

/** Bytes in one MB. The policy travels over the API in whole MB — the unit the admin form uses. */
export const MB_BYTES = 1024 * 1024;

/**
 * The box a re-encoded image is fitted inside, longest edge in CSS pixels. Aspect ratio is
 * preserved and an image already inside the box keeps its dimensions, so this only ever removes
 * pixels a conversation had no use for: 2048 is still above a 1080p screenshot, and a phone photo
 * at 4032px carries four times the pixels for detail nothing downstream reads.
 */
export const IMAGE_MAX_EDGE = 2048;

/**
 * Encoder quality for the lossy formats. 0.82 is the usual knee — visually indistinguishable from
 * the source at ordinary viewing size, and a large fraction of the bytes gone.
 */
export const IMAGE_QUALITY = 0.82;

/**
 * Types that survive a canvas round trip intact.
 *
 * The exclusions matter more than the list. An animated GIF comes back as its first frame, and an
 * SVG is resolution-independent until a canvas rasterizes it — for both, "smaller" would mean
 * "different picture", which is not a trade this is allowed to make on the user's behalf. The
 * output keeps the input's type rather than picking a better codec, so alpha is preserved and
 * nothing downstream meets a format it did not already accept.
 */
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The part of a `File` the decision needs; keeps callers free to pass a test double. */
export interface SizedFile {
  type: string;
  size: number;
}

/** The server-supplied half of the decision. */
export interface CompressionPolicy {
  imageCompression: boolean;
  imageCompressionOverMb: number;
}

/**
 * Whether this pick is one to re-encode.
 *
 * The comparison is `>`, not `>=`: a file of exactly the threshold is left alone, so the number
 * an admin types reads as "larger than this", which is how the form words it.
 */
export function shouldCompress(file: SizedFile, policy: CompressionPolicy): boolean {
  if (!policy.imageCompression) return false;
  if (!COMPRESSIBLE.has(file.type)) return false;
  return file.size > policy.imageCompressionOverMb * MB_BYTES;
}

/**
 * Fit `width` x `height` inside a square of `maxEdge`, preserving the aspect ratio. An image
 * already inside the box is returned unchanged — a re-encode at the same dimensions is still
 * worth doing when the source is a needlessly large JPEG.
 *
 * Rounded, and floored at 1: a very thin image (a 4000x1 strip) would otherwise scale its short
 * edge to zero, which is a canvas of no pixels rather than a smaller picture.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Re-encode one image, or return the original.
 *
 * Every failure path returns the input rather than throwing: a browser without
 * `createImageBitmap`, a file the decoder rejects, a canvas the encoder will not read back from
 * (a tainted or over-large one). None of those is a reason the user's message should not go —
 * they only mean the picture travels at its original size, which is exactly what happened before
 * there was a compressor.
 *
 * The result is also discarded when it came out no smaller than the source, which is the ordinary
 * outcome for an already-optimized file: the point is fewer bytes, and a re-encode that adds them
 * is a re-encode worth throwing away.
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, file.type, IMAGE_QUALITY);
    });
    if (blob === null || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
