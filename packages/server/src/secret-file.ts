/**
 * Writes a bearer secret to a 0600 file, refusing to follow a symlink parked at the path:
 * someone who can write the directory but not read the file could otherwise redirect the write
 * into a file they CAN read. Hence unlink + exclusive create, and chmod on the fd rather than
 * the path. Exported as `@prismshadow/penguin-server/secret-file` so the CLI shares it.
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
