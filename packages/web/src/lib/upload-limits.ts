/**
 * The Workspace file browser's pre-flight size check, kept DOM-free so it can be tested directly.
 *
 * It is the last place in the app that holds a picked file against a number. The composer's
 * intakes no longer do: an attachment goes to the Session scratchpad and is read back by path,
 * so nothing downstream scales with its size. A Workspace upload is a different transaction —
 * it writes into a directory the user shares with their tools, over an endpoint with its own
 * `file_too_large`, and that endpoint's ceiling is the number this partition is given.
 */

/** Bytes in one MB. The limit is expressed in whole MB, the unit the endpoint states. */
export const MB_BYTES = 1024 * 1024;

/** The part of a `File` this check needs; keeps callers free to pass a test double. */
export interface SizedFile {
  name: string;
  size: number;
}

export interface SizeSplit<T> {
  /** Files within the ceiling, in the order they were picked. */
  accepted: T[];
  /** Files over it — refused before being read, so nothing is uploaded to earn the rejection. */
  rejected: T[];
}

/**
 * Split a picked batch against a per-file ceiling given in whole MB.
 *
 * The comparison is `>`, not `>=`: a file of exactly the limit is legal, matching the server's
 * own check. An off-by-one in this direction would be invisible in normal use and would reject
 * exactly the file a user resized to fit.
 *
 * Order is preserved on both sides, because the accepted order decides the order of the chips
 * and therefore of the `[attached file: …]` lines the message ends up carrying.
 */
export function splitBySize<T extends SizedFile>(
  files: Iterable<T>,
  limitMb: number,
): SizeSplit<T> {
  const limitBytes = limitMb * MB_BYTES;
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const file of files) {
    if (file.size > limitBytes) rejected.push(file);
    else accepted.push(file);
  }
  return { accepted, rejected };
}
