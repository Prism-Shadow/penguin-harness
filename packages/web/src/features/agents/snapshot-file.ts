/** Picking and reading Agent State snapshot packages (`<agentId>-v<n>.tar.gz`). */
import { labelButtonClass } from "../../components/ui/button";

/**
 * The button look on the `<a download>` / `<label>` the transfer actions and the snapshot picker
 * need — the settings page's transfers and the create dialog's picker, neither of which can be a
 * `<button>`.
 */
export const SNAPSHOT_BUTTON_CLASS = labelButtonClass("secondary", "sm");

/**
 * Accept list for the snapshot file pickers.
 *
 * Extensions alone are not enough: macOS pickers (Safari, and the desktop shell's native
 * dialog) map accept extensions to UTIs, and the double-dot `.tar.gz` maps to nothing —
 * exported packages then show up grayed out and unselectable. The MIME types and the bare
 * `.gz` keep them selectable everywhere; the server validates package structure anyway, so
 * the wider net admits nothing it cannot reject.
 */
export const SNAPSHOT_ACCEPT = ".tar.gz,.tgz,.gz,application/gzip,application/x-gzip";

/** Reads a picked file into the base64 payload the snapshot endpoints take. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1)); // strip the data:...;base64, prefix
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

/** Agent-id suggestion from a snapshot file name: `<agentId>-v<n>.tar.gz` → `<agentId>`. */
export function agentIdFromSnapshotName(fileName: string): string {
  return fileName.replace(/\.(tar\.gz|tgz|gz)$/i, "").replace(/-v\d+$/, "");
}
