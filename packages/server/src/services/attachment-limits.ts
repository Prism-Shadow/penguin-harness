/**
 * The one place every attachment size number is defined.
 *
 * Four layers used to carry their own copy of "10MB" — the composer's pre-flight check, the
 * server's per-file cap, the per-request budget and the global body cap — and nothing kept them
 * in step. They are derived from one another here instead, because the failure mode of a
 * disagreement is bad in a specific way: a client that allows more than the server does turns a
 * clear "too large" refusal into an upload that runs to completion and then dies on a generic
 * error.
 *
 * ## Why the numbers are what they are
 *
 * A file attachment is not multimodal input. It is written to the Session scratchpad and handed
 * to the model as an `[attached file: <path>]` line, which the model opens with its ordinary file
 * tools — the bytes never enter the conversation (see task-attachments.ts). Nothing downstream
 * therefore scales with the file's size, which is what makes a 100MB ceiling reasonable at all.
 *
 * An **inline image** is the opposite: it rides the conversation as a data URL, is written
 * verbatim into the Trace JSONL, and that file is read back whole — into a single JS string — on
 * every history page and every Session resume. A large inline image is not a slow request, it is
 * a Session that never recovers. So images keep their own much smaller ceiling
 * (INLINE_IMAGE_MAX_MB) and deliberately do NOT follow the attachment limit up.
 *
 * ## The transport tax
 *
 * A draft chat has no Session yet, so there is nowhere to upload to before the message exists:
 * attachments ride the task request itself as base64 `data:` URLs. Base64 inflates by 4/3, so the
 * body cap has to be derived from the byte budget rather than fixed, or the request dies at the
 * HTTP layer with `payload_too_large` while every attachment was individually legal.
 */

/** Bytes per MB. The admin-facing settings are whole MB; everything internal is bytes. */
const MB = 1024 * 1024;

/**
 * Per-file default. The issue asked for 100MB and nothing on the file path scales with it —
 * the bytes go to disk and are read back through the model's bounded file tools, never into
 * the conversation.
 */
export const DEFAULT_ATTACHMENT_MAX_MB = 100;

/**
 * Per-request default, kept at 1.2x the per-file default exactly as the old 10/12 pair was: one
 * full-size attachment stays sendable next to a couple of ordinary ones, without letting a single
 * message carry twenty full-size ones.
 */
export const DEFAULT_ATTACHMENT_TOTAL_MB = 120;

/** Floor for both admin-settable limits: below 1MB the feature stops being useful at all. */
export const MIN_ATTACHMENT_MB = 1;

/**
 * Ceiling for both admin-settable limits — the reason an admin typing 100GB is refused rather
 * than obeyed.
 *
 * This is not a taste judgement, it is where the transport actually stops working. The whole
 * request body is buffered and JSON-parsed as one string, and V8 caps a string near 512MB. At
 * 200MB of decoded attachments the body is ~267MB of base64 plus headroom — comfortably inside
 * that wall, with the peak memory of one such request (raw body + parsed string + decoded
 * buffers) still on the order of a gigabyte. Anything materially larger stops failing with a 413
 * and starts failing with a RangeError, which is exactly the "worse than a clear refusal" outcome
 * this module exists to prevent.
 */
export const MAX_ATTACHMENT_MB = 200;

/**
 * Per-request file count. Deliberately NOT admin-settable: it bounds how many files one message
 * can name, which is a composer-usability question, not a server-resource one — the byte budgets
 * above are what actually bound memory and disk. 20 is far past any plausible composer use (the
 * chip row stops being usable long before that) while still allowing "drop a folder of small
 * files in".
 */
export const MAX_ATTACHMENT_COUNT = 20;

/**
 * Per-image ceiling for images that ride the conversation inline.
 *
 * Before this existed, images were bounded by nothing but the global body cap — the only reason a
 * 50MB paste failed was that the body cap happened to be 20MB. Raising that cap for attachments
 * would have silently handed images the new ceiling too, letting one paste write a 100MB+ record
 * into the Trace. 20MB is above what the old body cap effectively allowed (~15MB decoded), so no
 * paste that works today stops working; it is a bound where there was none, not a new restriction.
 *
 * Note this is the *transport* ceiling, not a promise the model will accept the image: providers
 * impose their own per-image limits (commonly ~5MB), and core's `read_file` caps an image at 5MB.
 * An image between those numbers and this one uploads fine and may still be refused by the model.
 */
export const INLINE_IMAGE_MAX_MB = 20;

/** Byte length of the base64 encoding of `bytes` bytes (4 characters per 3-byte group, padded). */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/**
 * Slack added on top of the base64'd attachment budget when deriving the body cap: one full-size
 * inline image (images are capped individually but not in aggregate, so the body cap is what
 * bounds a request carrying several), plus 4MB for the message text and the JSON framing around
 * all of it. Derived rather than hardcoded so that changing the image ceiling cannot leave the
 * body cap too small to carry one.
 *
 * A request that fills the whole attachment budget *and* carries a full-size image is over the cap
 * and is refused — correctly, since that is genuinely more than the budget allows.
 */
const BODY_HEADROOM_BYTES = base64Length(INLINE_IMAGE_MAX_MB * MB) + 4 * MB;

/**
 * The resolved, in-force limits for one request, in bytes. Read fresh per request from the
 * settings repo rather than snapshotted at boot, so an admin's change applies to the very next
 * upload without a restart.
 */
export interface AttachmentLimits {
  /** Per-file cap. */
  maxBytes: number;
  /** Per-request total of decoded attachment bytes. */
  totalBytes: number;
  /** Per-request file count. */
  maxCount: number;
}

/** Admin-settable limits as they travel over the API: whole MB, which is the unit the form uses. */
export interface AttachmentLimitsMb {
  attachmentMaxMb: number;
  attachmentTotalMb: number;
}

/** Resolve the MB-denominated settings into the byte limits the validators enforce. */
export function toAttachmentLimits(mb: AttachmentLimitsMb): AttachmentLimits {
  return {
    maxBytes: mb.attachmentMaxMb * MB,
    totalBytes: mb.attachmentTotalMb * MB,
    maxCount: MAX_ATTACHMENT_COUNT,
  };
}

/** The inline-image ceiling in bytes (a constant, but expressed through the same MB unit). */
export const INLINE_IMAGE_MAX_BYTES = INLINE_IMAGE_MAX_MB * MB;

/**
 * The global request body cap implied by the attachment budget.
 *
 * Derived rather than fixed so the two can never disagree: the cap is always large enough for a
 * full attachment budget once base64 has inflated it, and no larger than that plus one image's
 * worth of headroom. An admin who lowers the attachment limit gets a smaller body cap back — the
 * server does not keep accepting 300MB bodies because it once could.
 */
export function bodyLimitBytes(mb: AttachmentLimitsMb): number {
  return base64Length(mb.attachmentTotalMb * MB) + BODY_HEADROOM_BYTES;
}

/**
 * Clamp a stored setting back into range. Rows are written only through the validated PUT, so
 * this matters for a value that predates a change to the bounds, or a hand-edited database —
 * cases where refusing to start would be a worse answer than using the nearest legal number.
 */
export function clampAttachmentMb(value: number, fallback: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  return Math.min(MAX_ATTACHMENT_MB, Math.max(MIN_ATTACHMENT_MB, value));
}
