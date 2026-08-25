/** Picking and reading Agent State snapshot packages (`<agentId>-v<n>.tar.gz`). */

/**
 * <a download>/<label> version of the button look (matches Button secondary sm; the Button
 * component only renders <button>): the settings page's transfer actions and the create
 * dialog's snapshot picker.
 */
export const SNAPSHOT_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-gray-300 " +
  "bg-white px-2.5 py-1 text-xs font-medium text-gray-800 transition-colors duration-150 " +
  "hover:bg-gray-50 focus-within:ring-2 focus-within:ring-gray-400/30 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800";

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
