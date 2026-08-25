/**
 * Writing a bearer secret to a 0600 file without following a symlink.
 *
 * One place, because the same write lands wherever a credential hits disk — this boot's owner
 * token, the CLI's saved session — and the hole it closes appeared once in each before this was
 * shared. Someone who can write the directory but not read the file could park a symlink at the
 * path and have the write redirected into a file they CAN read. Unlink first, then create
 * exclusively (O_NOFOLLOW where the platform has it), so a link planted in the race window fails
 * the create rather than being followed; set the mode on the fd, since the path could be
 * re-pointed between create and chmod.
 *
 * Published as `@prismshadow/penguin-server/secret-file` (side-effect-free) so the CLI shares it.
 */
import fs from "node:fs";

export function writeSecretFile(filePath: string, contents: string): void {
  fs.rmSync(filePath, { force: true });
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(filePath, flags, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, contents);
  } finally {
    fs.closeSync(fd);
  }
}
