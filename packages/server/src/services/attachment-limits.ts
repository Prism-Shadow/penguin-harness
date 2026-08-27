/**
 * The two bounds an attachment-carrying request has. Neither is configurable, and that is the
 * point: a size an operator can type is a size some user meets as a 413 after the file has
 * already been read and base64'd, and every layer that quotes the number has to be kept in step
 * with it. What is here is the bound the transport actually has, and a count that keeps the
 * composer's chip row usable.
 *
 * ## Why an inline image is a different thing from a file
 *
 * A file attachment is written to the Session scratchpad and handed to the model as an
 * `[attached file: <path>]` line, which it opens with its ordinary file tools — the bytes never
 * enter the conversation (see task-attachments.ts), so nothing downstream scales with the file's
 * size. That is what makes an unbounded per-file size reasonable at all.
 *
 * An inline image is the opposite: it rides the conversation as a data URL, is written verbatim
 * into the Trace JSONL, and that file is read back whole — into one JS string — on every history
 * page and every Session resume. A large inline image is not a slow request, it is a Session that
 * gets slower every time it is opened.
 *
 * That cost is paid by making the image smaller rather than by refusing it: the composer
 * re-encodes an image over the configured threshold before it is ever uploaded
 * (services/image-compression.ts for the policy, web's lib/image-compress.ts for the encode).
 * The same move points the image at a size the model will take — providers commonly cap a single
 * image around 5MB, and core's `read_image` tool at 5MB — so an image big enough to hurt the
 * Trace is one that was heading for a refusal further down regardless.
 */

/** Bytes per MB. */
const MB = 1024 * 1024;

/**
 * Per-request file count. It bounds how many files one message can name, which is a composer
 * question rather than a server-resource one — the body cap below is what bounds memory and
 * disk. 20 is far past any plausible composer use (the chip row stops being usable long before
 * that) while still allowing "drop a folder of small files in".
 */
export const MAX_ATTACHMENT_COUNT = 20;

/**
 * The global request body cap.
 *
 * This is where the transport stops working, not a preference. The whole body is buffered and
 * JSON-parsed as one string, and V8 caps a string near 512MB (2^29 - 24 characters); a base64
 * payload is ASCII, so the body's byte count is its character count. 384MB leaves a quarter of
 * that wall as headroom, which is what keeps an oversize request failing as a clear 413 rather
 * than as a RangeError out of `JSON.parse`. Peak memory for one request at the cap — raw body,
 * parsed string, decoded buffers — is on the order of a gigabyte; that is the tolerance this
 * number states.
 */
export const BODY_MAX_BYTES = 384 * MB;
