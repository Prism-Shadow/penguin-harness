/** Picking an Agent package to import: a zip export (`<agentId>-<yyyymmdd>.zip`), or an older `.tar.gz` snapshot package. */
import { buttonClass } from "@prismshadow/penguin-ui";

/** The button look on the `<label>` around the file picker, which cannot be a `<button>`. */
export const ARCHIVE_BUTTON_CLASS = buttonClass("secondary", "sm");

/**
 * macOS pickers map accept extensions to UTIs, and the double-dot `.tar.gz` maps to nothing: the
 * gzip MIME types and the bare `.gz` keep an older package selectable. The server checks what it
 * receives anyway. The `.tar.gz` entries leave with 1.0.
 */
export const ARCHIVE_ACCEPT =
  ".zip,application/zip,.tar.gz,.tgz,.gz,application/gzip,application/x-gzip";

/** The id a file name suggests: `<id>-<yyyymmdd>.zip`, `<id>.zip` and `<id>-v<n>.tar.gz` give `<id>`. */
export const agentIdFromArchiveName = (fileName: string): string =>
  fileName.replace(/\.(zip|tar\.gz|tgz|gz)$/i, "").replace(/-(\d{8}|v\d+)$/, "");
