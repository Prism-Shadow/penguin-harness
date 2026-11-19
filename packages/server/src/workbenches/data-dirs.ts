/**
 * A workbench's own folders, as `WorkbenchHost.dataPaths()` hands them out:
 *
 *   dataDir   <agentDir>/app/data/<id>/     files the workbench and its Agent both write; exported
 *   cacheDir  <agentDir>/app/cache/<id>/    files that can be made again; never exported
 *   stateDir  <root>/run/<p>/<a>/<w>/       sockets, pipes, locks; never exported
 *
 * (core's `workbenchDataDir`, `workbenchCacheDir`, `workbenchStateDir`). The host only makes
 * them and says where they are: a handler reads and writes them with Node's own `fs`, and serves
 * whatever its page needs from its own routes.
 *
 * The Agent's sandboxed commands may write `<agentDir>/app` and its `run/` folder, so a link may
 * stand where one of these folders belongs. Nothing here goes through one: making a folder
 * checks every level below the trusted base (the Agent's directory, or the data root for the
 * state folder) is a real directory, and removing one never reaches through a link on the way.
 * What the handler then does inside its folders is its own: it is server code, unconfined.
 */
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * The longest Unix socket path, in bytes, a workbench is given: macOS's `sun_path` holds 104
 * with its terminator (Linux 108). The stricter of the two, so a workbench that runs on one runs
 * on the other.
 */
export const MAX_SOCKET_PATH_BYTES = 103;

export class WorkbenchDirError extends Error {}

/** `dir`'s levels below `base`. */
const levels = (base: string, dir: string): string[] => path.relative(base, dir).split(path.sep);

/**
 * Whether every directory from `base` down through `segments` is there, each a real directory:
 * false when one is simply missing; a link or a file on the way throws. `base` itself is trusted.
 */
export async function realDirs(
  base: string,
  segments: readonly string[],
  call: string,
): Promise<boolean> {
  let at = base;
  for (const segment of segments) {
    at = path.join(at, segment);
    const stat = await fs.lstat(at).catch(() => null);
    if (stat === null) return false;
    if (!stat.isDirectory()) {
      throw new WorkbenchDirError(`${call}: ${at} is a link or a file, not a directory`);
    }
  }
  return true;
}

/**
 * Makes `dir` (below the trusted `base`) when it is missing, one level at a time, each a real
 * directory readable by this user only. A link or a file where a level belongs throws.
 */
export function ensureDir(base: string, dir: string, call: string): void {
  let at = base;
  for (const segment of levels(base, dir)) {
    at = path.join(at, segment);
    try {
      fsSync.mkdirSync(at, { mode: 0o700 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    if (!fsSync.lstatSync(at).isDirectory()) {
      throw new WorkbenchDirError(`${call}: ${at} is a link or a file, not a directory`);
    }
  }
}

/**
 * Removes `dir` and everything in it, `dir` lying below the trusted `base`. A link on the way
 * to it throws and nothing is removed; `dir` itself as a link goes as a link, and `rm` removes a
 * link inside without following it.
 */
export async function removeBelow(base: string, dir: string): Promise<void> {
  if (!(await realDirs(base, levels(base, dir).slice(0, -1), "remove"))) return;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * Where a workbench listens on `name`: a file in its state folder, or on Windows, where a local
 * socket is a named pipe and no path on disk, `\\.\pipe\penguin-<16 hex>-<name>` (the hex names
 * the state folder, so two workbenches, or two servers, never share a pipe). Refuses a name that
 * is not one plain segment, and a path past {@link MAX_SOCKET_PATH_BYTES}, which `listen` would
 * otherwise refuse with a bare EINVAL, or on Linux take though macOS would not.
 */
export function socketPathIn(
  stateDir: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (
    typeof name !== "string" ||
    name === "" ||
    name === "." ||
    name === ".." ||
    /[/\\\0]/.test(name)
  ) {
    throw new WorkbenchDirError(`socketPath: ${JSON.stringify(name)} is not a plain file name`);
  }
  if (platform === "win32") {
    const id = createHash("sha256").update(stateDir).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\penguin-${id}-${name}`;
  }
  const at = path.join(stateDir, name);
  const bytes = Buffer.byteLength(at);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new WorkbenchDirError(
      `socketPath: ${at} is ${bytes} bytes; a Unix socket path holds at most ` +
        `${MAX_SOCKET_PATH_BYTES} (macOS allows 104 with the terminator, Linux 108), so the name ` +
        `may be at most ${Math.max(0, MAX_SOCKET_PATH_BYTES - Buffer.byteLength(stateDir) - 1)} ` +
        `bytes here: choose a shorter name, or a shorter data root (PENGUIN_HOME)`,
    );
  }
  return at;
}
