/**
 * A workbench's own folders, as `WorkbenchHost.dataPaths(level)` hands them out (core's paths):
 *
 *   agent    <agentDir>/app/{data,cache}/<id>/            state <root>/run/<p>/<a>/<w>/
 *   server   <root>/app/{data,cache}/<plugin>/<id>/       state <root>/run/server/<h>/
 *   machine  <machine>/{data,cache}/<plugin>/<id>/        state <machine>/run/<h>/
 *
 * `<machine>` is `~/.penguin/machine`. The agent level is this Agent's copy of the app alone;
 * the server level every copy of the same plugin's workbench on this data root; the machine
 * level every data root of this OS user on this computer. The shared levels need the plugin the
 * workbench came from, so a workbench made in place has none. The host only makes the folders
 * and says where they are: a handler reads and writes them with Node's own `fs`, and serves
 * whatever its page needs from its own routes.
 *
 * Only the agent level is writable to the Agent's sandboxed commands ({@link agentWritableRoots}),
 * so a link may stand where one of its folders belongs. Nothing here goes through one: making a
 * folder checks every level below its trusted base (the Agent's directory, the data root, the
 * machine folder) is a real directory, and removing one never reaches through a link on the way.
 * What the handler then does inside its folders is its own: it is server code, unconfined.
 */
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import {
  agentAppDir,
  agentDir,
  agentRunDir,
  machineAppDir,
  projectDir,
  runDir,
  serverAppDir,
  sharedWorkbenchDirs,
  workbenchCacheDir,
  workbenchDataDir,
  workbenchStateDir,
} from "@prismshadow/penguin-core";
import type { WorkbenchDataLevel, WorkbenchDataPaths } from "../mechanisms/workbenches.js";

/**
 * The longest Unix socket path, in bytes, a workbench is given: macOS's `sun_path` holds 104
 * with its terminator (Linux 108). The stricter of the two, so a workbench that runs on one runs
 * on the other.
 */
export const MAX_SOCKET_PATH_BYTES = 103;

// The link-safety helpers live in the agent domain library beside their package consumer (the
// agent domain's agent-app-data); re-exported here for this module's consumers.
export {
  realDirs,
  removeBelow,
  WorkbenchDirError,
} from "@prismshadow/penguin-library-agent/workbench-dirs";
import { WorkbenchDirError } from "@prismshadow/penguin-library-agent/workbench-dirs";

/** `dir`'s levels below `base`. */
const levels = (base: string, dir: string): string[] => path.relative(base, dir).split(path.sep);

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

const LEVELS: readonly WorkbenchDataLevel[] = ["agent", "server", "machine"];

/** Where one workbench is, for {@link levelFolders}. */
export interface WorkbenchPlace {
  root: string;
  projectId: string;
  agentId: string;
  workbenchId: string;
  /** The plugin that installed it; null for a workbench made in place. */
  plugin: string | null;
}

/**
 * Refuses `dir`, one of the data root's own folders (`app`, `run`), when it is the link the
 * layout migration left at the old place of a Project called so (PRFC-0034): the Project's
 * folder is under `<root>/projects/` now, but the link stands until 1.0, and no workbench folder
 * is ever made through a link — or inside a Project's folder. Making a folder would refuse the
 * link anyway (ensureDir); this says why.
 */
function refuseProjectLink(root: string, dir: string, call: string): void {
  const name = path.basename(dir);
  let link = false;
  try {
    link = fsSync.lstatSync(dir).isSymbolicLink();
  } catch {
    // Nothing there yet: the folder is made when first asked for.
  }
  if (link) {
    throw new WorkbenchDirError(
      `${call}: ${dir} is the link to the folder of the Project "${name}", which moved to ` +
        `${projectDir(root, name)}; the link stays until 1.0, so this server keeps ` +
        `no workbench folders there until then`,
    );
  }
}

/**
 * A level's three folders for one workbench, and the trusted base each is made below. Throws for
 * a level that is none of the three, for a shared level of a workbench made in place, and where
 * a folder would fall through the link a Project called `app` or `run` left at its old place.
 */
export function levelFolders(
  level: unknown,
  at: WorkbenchPlace,
  call: string,
): { paths: WorkbenchDataPaths; bases: WorkbenchDataPaths } {
  const chosen = level ?? "agent";
  if (!LEVELS.includes(chosen as WorkbenchDataLevel)) {
    throw new WorkbenchDirError(
      `${call}: level is "agent", "server" or "machine", not ${JSON.stringify(level)}`,
    );
  }
  const { root, projectId, agentId, workbenchId, plugin } = at;
  // The agent and server levels keep their state under `<root>/run`, the server level its data
  // and cache under `<root>/app`; the machine level is outside the data root.
  if (chosen !== "machine") refuseProjectLink(root, runDir(root), call);
  if (chosen === "server") refuseProjectLink(root, serverAppDir(root), call);
  if (chosen === "agent") {
    const agent = agentDir(root, projectId, agentId);
    return {
      paths: {
        dataDir: workbenchDataDir(root, projectId, agentId, workbenchId),
        cacheDir: workbenchCacheDir(root, projectId, agentId, workbenchId),
        stateDir: workbenchStateDir(root, projectId, agentId, workbenchId),
      },
      bases: { dataDir: agent, cacheDir: agent, stateDir: root },
    };
  }
  if (plugin === null) {
    throw new WorkbenchDirError(
      `${call}: the ${chosen} level is shared by every copy of an app installed from a plugin, ` +
        `and workbench ${JSON.stringify(workbenchId)} was made in place: keep its files at the agent level`,
    );
  }
  if (chosen === "server") {
    return {
      paths: sharedWorkbenchDirs(
        serverAppDir(root),
        path.join(runDir(root), "server"),
        plugin,
        workbenchId,
      ),
      bases: { dataDir: root, cacheDir: root, stateDir: root },
    };
  }
  const machine = machineAppDir();
  // The machine folder itself is trusted, as the data root is: below it nothing is.
  fsSync.mkdirSync(machine, { recursive: true, mode: 0o700 });
  return {
    paths: sharedWorkbenchDirs(machine, path.join(machine, "run"), plugin, workbenchId),
    bases: { dataDir: machine, cacheDir: machine, stateDir: machine },
  };
}

/**
 * What the Agent's sandboxed commands may write besides the Workspace and the Session's
 * scratchpad: the agent level of its workbenches (`<agentDir>/app` and its `run/` folder), and
 * nothing of the server or machine level, which every Project's copy of an app reads.
 */
export function agentWritableRoots(root: string, projectId: string, agentId: string): string[] {
  return [agentAppDir(root, projectId, agentId), agentRunDir(root, projectId, agentId)];
}
