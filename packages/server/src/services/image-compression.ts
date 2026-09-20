/**
 * The server-global policy for the composer's automatic image compression: whether it runs, and
 * the size above which it does.
 *
 * The encode itself happens in the browser, before the image becomes a data URL (web's
 * lib/image-compress.ts). Doing it there is what makes it worth doing at all — the upload shrinks
 * with the image, so a large paste stops costing a base64 encode and a transfer 33% larger than
 * the file on the way to a Trace entry that is re-read for the life of the Session. A server-side
 * pass would spend all of that first and only then make the picture smaller.
 *
 * The policy is nevertheless the server's, delivered on `/api/me`: what a large inline image
 * costs is paid on the server's disk and in every future resume of the Session, so it is the
 * operator who has the standing to decide it, not each tab. A client that ignores the policy is
 * not refused — nothing here is a gate.
 *
 * ## The threshold
 *
 * Below it an image is uploaded byte-for-byte, which is what keeps a pasted UI screenshot legible
 * and an already-optimized asset untouched. Above it the picture is being sent for its content,
 * not its pixels, and re-encoding it is a better answer than either uploading it whole or
 * refusing it.
 */

/** Bytes per MB. The admin-facing setting is whole MB; everything internal is bytes. */
const MB = 1024 * 1024;

/** Compression is on unless an operator turns it off. */
export const DEFAULT_IMAGE_COMPRESSION = true;

/**
 * Default threshold. 4MB sits just under the ~5MB a provider commonly accepts for one image and
 * core's `read_image` cap, so the images it catches are the ones that were unlikely to survive
 * the model side at full size anyway — and comfortably above a screenshot, which is the picture
 * whose pixels a user is most likely to care about.
 */
export const DEFAULT_IMAGE_COMPRESSION_OVER_MB = 4;

/** Floor for the threshold: below 1MB nearly every picture is re-encoded, screenshots included. */
export const MIN_IMAGE_COMPRESSION_OVER_MB = 1;

/**
 * Ceiling for the threshold. Above 64MB the setting stops distinguishing anything: an inline
 * image that large is already the Session-wide cost this feature exists to avoid, so a threshold
 * that never fires below it would be a way of spelling "off" that does not say so.
 */
export const MAX_IMAGE_COMPRESSION_OVER_MB = 64;

/** The policy as it travels over the API, and as the settings form edits it. */
export interface ImageCompressionSettings {
  /** Whether the composer re-encodes images above the threshold. */
  imageCompression: boolean;
  /** Images larger than this many MB are re-encoded; smaller ones are uploaded untouched. */
  imageCompressionOverMb: number;
}

/** The threshold in bytes — the unit the composer compares a `File.size` against. */
export function imageCompressionOverBytes(mb: number): number {
  return mb * MB;
}

/**
 * Clamp a stored threshold back into range. Rows are written only through the validated PUT, so
 * this matters for a value that predates a change to the bounds, or a hand-edited database —
 * cases where the nearest legal number is a better answer than refusing to serve the settings.
 */
export function clampImageCompressionOverMb(value: number, fallback: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  return Math.min(MAX_IMAGE_COMPRESSION_OVER_MB, Math.max(MIN_IMAGE_COMPRESSION_OVER_MB, value));
}
