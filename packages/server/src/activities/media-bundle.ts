/**
 * Limits and naming for the project media library: how much one listing reports, how
 * much one downloaded bundle may hold, and what each file is called inside the zip.
 */
import { UPLOAD_PREFIX } from "./upload.js";

/** The most files one project listing reports, newest first. */
export const PROJECT_MEDIA_LIMIT = 5000;

/** The most files one bundle may hold. */
export const BUNDLE_MAX_ITEMS = 60;

/** The most bytes one bundle may hold, before it is zipped. */
export const BUNDLE_MAX_BYTES = 200 * 1024 * 1024;

/** The name a downloaded bundle is saved under. */
export const BUNDLE_FILE_NAME = "media-library-selection.zip";

/**
 * Names for the entries of one zip, in order. A name already taken becomes `stem-2.ext`,
 * then `stem-3.ext`, and so on, so two files never overwrite each other when unzipped.
 */
export function bundleEntryNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    for (let counter = 2; taken.has(candidate.toLowerCase()); counter++)
      candidate = `${stem}-${counter}${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * The name to store a copied upload under: the stored name without the digest this
 * server added, so the copy lands on the same `stem-<digest>.ext` path as the original.
 */
export function copiedUploadName(reference: string): string {
  const name = reference.startsWith(UPLOAD_PREFIX)
    ? reference.slice(UPLOAD_PREFIX.length)
    : reference;
  return name.replace(/-(?:[a-f0-9]{64}|[a-f0-9]{16})(?=\.[A-Za-z0-9]+$)/, "");
}
