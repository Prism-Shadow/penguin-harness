/**
 * Caps shared by every path that pulls Skill files in from outside the library — the archive
 * upload/download routes and the directory import. One set of numbers, so a limit raised for one
 * entry point cannot quietly leave another behind, and one message, so the failure reads the same
 * wherever the user hit it.
 */
import { HttpError } from "../http/errors.js";

export const MAX_ARCHIVE_FILES = 200;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export function skillTooLarge(): HttpError {
  return new HttpError(
    413,
    "skill_too_large",
    `Skill directory exceeds the archive limits (${MAX_ARCHIVE_FILES} files, 5MB per file, 20MB total).`,
  );
}
