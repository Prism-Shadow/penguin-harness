/**
 * The caps of the Agent archive (the zip export/import). An import is bounded on the way in:
 * the upload as it arrives, the central directory before anything is inflated, and the bytes
 * actually written while it is. An export has no cap of its own; the preview says when a
 * selection is larger than an import would take, and leaves out a Session one of whose files
 * no import would take.
 *
 * The global request-body cap (http/app.ts, derived from the attachment budget) still applies
 * in front of the upload cap, so a server whose attachment limit was lowered takes less.
 */
import { HttpError } from "../http/errors.js";

const MiB = 1024 * 1024;

/** The zip or `.tar.gz` as uploaded. */
export const MAX_UPLOAD_BYTES = 100 * MiB;
/** Entries one zip may hold, directories included. */
export const MAX_ENTRIES = 50_000;
/** One entry, uncompressed; a Session with a larger file is left out of an export. */
export const MAX_ENTRY_BYTES = 256 * MiB;
/** Everything an import inflates, counted on the bytes written. */
export const MAX_INFLATED_BYTES = 1024 * MiB;
/** The most Sessions `traces=last:<N>` selects. */
export const MAX_LAST_SESSIONS = 500;

export function archiveTooLarge(message: string): HttpError {
  return new HttpError(413, "archive_too_large", message);
}
