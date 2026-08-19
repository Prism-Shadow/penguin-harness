/**
 * The composer's pre-flight size check, kept DOM-free so it can be tested directly.
 *
 * Both composer intakes need it and they need it with *different* ceilings: a file attachment is
 * written to the Session scratchpad and read back by path, so it can be large, while an inline
 * image rides the conversation and the Trace and cannot. Sharing the partition function rather
 * than the number is what lets the two stay different without the check itself being written
 * twice.
 *
 * The ceilings themselves are not defined here. They are admin-settable and arrive from the
 * server on `/api/me` (see state/auth `uploadLimits`), because a limit the browser invented would
 * be a limit the server does not enforce — and the failure mode of that disagreement is the one
 * worth avoiding: a client that allows more than the server does turns a clear refusal into a
 * full upload that dies on a generic error.
 */

/** Bytes in one MB. Limits travel over the API in whole MB — the unit the admin form uses. */
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
 * own check (`bytes.length > limits.maxBytes`). An off-by-one in this direction would be
 * invisible in normal use and would reject exactly the file a user resized to fit.
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
