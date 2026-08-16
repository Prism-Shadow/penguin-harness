/**
 * "What is on that machine already?" — one ssh round trip, and the decision it feeds.
 *
 * Everything here is pure text in, structured data out: the command is a string this module
 * builds, the answer is a string the caller hands back. The ssh execution itself lives in
 * exec.ts, which keeps this file testable without a network or an ssh binary.
 *
 * Two constraints shape the command:
 * - **Absolute paths only.** `ssh host '<cmd>'` runs a non-login, non-interactive shell,
 *   whose `.bashrc` usually returns early; PATH is minimal and `~/.local/bin` is typically
 *   not on it, so the installer's convenience symlink cannot be relied on.
 * - **It must never fail.** Every probe line is guarded, so a missing penguin, a missing
 *   node or an unreadable lock file all answer "empty" rather than making ssh exit non-zero
 *   and turning "not installed yet" into "the connection failed".
 */

/** Where install.sh puts the program (XDG data dir), as seen from the remote's own $HOME. */
const REMOTE_PROGRAM_DIR = '"${XDG_DATA_HOME:-$HOME/.local/share}"/penguin';

/** Where the data root lives (core's PENGUIN_HOME default) — the server lock sits under it. */
const REMOTE_LOCK_FILE = '"$HOME"/.penguin/data/server.lock';

/**
 * The probe, as one `sh -c` payload. Output is `key=value` lines so parsing never depends on
 * ordering or on locale-formatted text.
 */
export const PROBE_COMMAND = [
  `printf 'penguin='; ${REMOTE_PROGRAM_DIR}/bin/penguin --version 2>/dev/null || printf '\\n'`,
  `printf 'uname='; uname -s -m 2>/dev/null || printf '\\n'`,
  `printf 'node='; command -v node >/dev/null 2>&1 && node -v 2>/dev/null || printf '\\n'`,
  `printf 'lock='; { cat ${REMOTE_LOCK_FILE} 2>/dev/null | tr -d '\\n'; printf '\\n'; }`,
].join("; ");

export interface RemoteProbe {
  /** Version reported by an installed penguin, or null when nothing is installed there. */
  version: string | null;
  /** `uname -s -m`, e.g. "Linux x86_64"; null when the command produced nothing. */
  uname: string | null;
  /** System Node version (`v24.3.0`), or null when the remote has no node on PATH. */
  nodeVersion: string | null;
  /** Raw contents of the server lock file, or null when no server has run there. */
  lock: string | null;
}

/** Reads the probe's `key=value` lines; unknown keys and stray output are ignored. */
export function parseProbe(stdout: string): RemoteProbe {
  const values = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values.set(line.slice(0, eq), line.slice(eq + 1).trim());
  }
  const read = (key: string): string | null => {
    const value = values.get(key);
    return value === undefined || value === "" ? null : value;
  };
  return {
    version: read("penguin"),
    uname: read("uname"),
    nodeVersion: read("node"),
    lock: read("lock"),
  };
}

/** Major version of a `vX.Y.Z` / `X.Y.Z` string, or null when it does not look like one. */
function majorOf(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : null;
}

/** The minimum the universal payload can run on: it ships no Node runtime of its own. */
export const MIN_REMOTE_NODE_MAJOR = 24;

export type InstallAction =
  /** Nothing there: offer to install. */
  | { action: "install"; reason: "absent" }
  /** Installed, but not the version this app would push. */
  | { action: "install"; reason: "version-mismatch"; remoteVersion: string }
  /** Installed at the same version: nothing to do. */
  | { action: "use"; remoteVersion: string }
  /** Cannot proceed, with the reason to show verbatim. */
  | { action: "blocked"; reason: "no-node" | "node-too-old" | "unreachable"; detail: string };

/**
 * What to do with a probed machine. The version rule is equality, not "newer wins": the
 * program is one build — CLI, server and web assets together — so a remote running any
 * other version is replaced rather than reasoned about.
 *
 * A remote Node older than the payload needs is refused up front instead of installing
 * something that cannot start, and so is a remote with no Node at all: the payload this app
 * pushes is the universal one, which carries no runtime.
 */
export function planRemoteInstall(probe: RemoteProbe, localVersion: string): InstallAction {
  if (probe.uname === null) {
    return {
      action: "blocked",
      reason: "unreachable",
      detail: "The probe returned nothing — the host answered but ran no shell.",
    };
  }
  if (probe.version !== null && probe.version.trim() === localVersion.trim()) {
    return { action: "use", remoteVersion: probe.version.trim() };
  }
  if (probe.nodeVersion === null) {
    return {
      action: "blocked",
      reason: "no-node",
      detail: `No node on PATH. PenguinHarness needs Node >= ${MIN_REMOTE_NODE_MAJOR} there.`,
    };
  }
  const major = majorOf(probe.nodeVersion);
  if (major === null || major < MIN_REMOTE_NODE_MAJOR) {
    return {
      action: "blocked",
      reason: "node-too-old",
      detail: `Node ${probe.nodeVersion} is installed; PenguinHarness needs >= ${MIN_REMOTE_NODE_MAJOR}.`,
    };
  }
  if (probe.version === null) return { action: "install", reason: "absent" };
  return { action: "install", reason: "version-mismatch", remoteVersion: probe.version.trim() };
}
