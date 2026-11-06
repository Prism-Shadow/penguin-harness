/** Picking an Agent archive to import: a zip export (`<agentId>-<yyyymmdd>.zip`), or an older `.tar.gz` package. */
import { buttonClass } from "@prismshadow/penguin-ui";

/** The button look on the `<label>` around the file picker, which cannot be a `<button>`. */
export const ARCHIVE_BUTTON_CLASS = buttonClass("secondary", "sm");

/**
 * Accept list for the archive file pickers.
 *
 * Extensions alone are not enough: macOS pickers (Safari, and the desktop shell's native
 * dialog) map accept extensions to UTIs, and the double-dot `.tar.gz` maps to nothing — the
 * package then shows up grayed out and unselectable. The MIME types and the bare `.gz` keep it
 * selectable everywhere; the server checks what it receives anyway, so the wider net admits
 * nothing it cannot refuse.
 *
 * Compatibility: the `.tar.gz` entries (`.tar.gz`, `.tgz`, `.gz` and the two gzip types) admit the
 * Agent State packages written before the zip export. They leave with the 1.0 release, together
 * with the server's `agent-archive/tar-compat.ts`.
 */
export const ARCHIVE_ACCEPT =
  ".zip,application/zip,.tar.gz,.tgz,.gz,application/gzip,application/x-gzip";

/**
 * Agent-id suggestion from an archive's file name: `<agentId>-<yyyymmdd>.zip` (the export's
 * name), `<agentId>.zip` and `<agentId>-v<n>.tar.gz` (an older package) give `<agentId>`. The
 * ` (1)` a browser appends to a second download of the same name goes too.
 */
export function agentIdFromArchiveName(fileName: string): string {
  return fileName
    .replace(/\.(zip|tar\.gz|tgz|gz)$/i, "")
    .replace(/ \(\d+\)$/, "")
    .replace(/-(\d{8}|v\d+)$/, "");
}

/**
 * Whether a picked file is an older `.tar.gz` Agent State package, which records no Agent id: the
 * import needs one named for it. Compatibility, like the accept list's `.tar.gz` entries: it
 * leaves with them at 1.0.
 */
export function isTarPackage(fileName: string): boolean {
  return /\.(tar\.gz|tgz|gz)$/i.test(fileName);
}
