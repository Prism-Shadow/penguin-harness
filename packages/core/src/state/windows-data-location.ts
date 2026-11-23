import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The Windows installer writes this per-user pointer only after verifying both directories. */
export function installedWindowsDataLocation(home = os.homedir()): string | undefined {
  if (process.platform !== "win32") return undefined;
  const directory = path.join(home, ".penguin");
  // The installer holds this file exclusively while copying. Windows releases the handle
  // even if setup crashes. A leftover unlocked file does not prevent normal startup.
  try {
    fs.closeSync(fs.openSync(path.join(directory, "windows-data-migration.lock"), "r"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        "PenguinHarness data is being moved or its location is inaccessible. Close setup or restore access.",
      );
    }
  }
  const file = path.join(directory, "windows-data-location");
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const base = bytes
    .toString("utf16le")
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n$/, "");
  if (bytes.length % 2 || !/^[A-Za-z]:\\.+/.test(base) || /[\0\r\n]/.test(base)) {
    throw new Error(`Invalid Windows data location in ${file}.`);
  }
  for (const name of ["data", "desktop"]) {
    const folder = path.join(base, name);
    if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(
        `PenguinHarness data is unavailable at ${folder}. Reconnect the drive and try again.`,
      );
    }
  }
  return base;
}
