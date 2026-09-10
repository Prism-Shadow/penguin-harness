/**
 * Caps shared by every path that pulls Skill files in from outside the library — the archive
 * upload/download routes and the directory import. One set of numbers, so a limit raised for one
 * entry point cannot quietly leave another behind, and one message, so the failure reads the same
 * wherever the user hit it. `unzipBounded` is where they are enforced on the way in, since an
 * archive can only be bounded before it is inflated.
 */
import { unzipSync } from "fflate";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";

export const MAX_ARCHIVE_FILES = 200;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * `unzipSync` with the caps above enforced from the central directory, before a byte is inflated.
 *
 * They have to be read there, because `unzipSync` allocates a buffer of each entry's declared
 * uncompressed size and inflates into it — so caps measured on what comes back bound nothing.
 * Zeros deflate at roughly 1000:1, which turns the largest archive the route accepts into
 * gigabytes of allocation; and an entry whose header overstates its size hands back a short view
 * onto a buffer of the declared length, passing every after-the-fact byte check outright.
 *
 * Bounding against the declared sizes is sound in the other direction too: the buffer is exactly
 * the declared size and fflate never grows it, so an entry can only ever yield fewer bytes than
 * it claimed. Directory entries carry no content and are left to the caller to filter.
 *
 * Throws the caps as 400s, matching the archive route this was factored out of; a corrupt
 * archive still throws whatever fflate throws, for the caller to translate.
 */
export function unzipBounded(archive: Uint8Array): Record<string, Uint8Array> {
  let files = 0;
  let declared = 0;
  return unzipSync(archive, {
    filter: ({ name, originalSize }) => {
      if (name.endsWith("/")) return true;
      files += 1;
      if (files > MAX_ARCHIVE_FILES) {
        throw badRequest(`The zip archive exceeds the ${MAX_ARCHIVE_FILES}-file limit.`);
      }
      if (originalSize > MAX_FILE_BYTES) {
        throw badRequest(`Zip entry exceeds the 5MB uncompressed limit: ${name}`);
      }
      declared += originalSize;
      if (declared > MAX_TOTAL_BYTES) {
        throw badRequest("The zip archive exceeds the 20MB uncompressed limit.");
      }
      return true;
    },
  });
}

export function skillTooLarge(): HttpError {
  return new HttpError(
    413,
    "skill_too_large",
    `Skill directory exceeds the archive limits (${MAX_ARCHIVE_FILES} files, 5MB per file, 20MB total).`,
  );
}
