/**
 * The `penguin` a command an Agent runs should find: this harness's own CLI, written into
 * the data root as a launcher script that every Session then puts at the front of PATH.
 *
 * Without it, `penguin` resolves against whatever the machine has installed globally — on a
 * development box that is the desktop app's bundled release, several versions away from the
 * checkout the server was started from, so an Agent asking its own harness to do something
 * gets `unknown command` for anything added since. The shim closes that gap without asking
 * the Agent to know any paths.
 *
 * Two facts make the launcher rather than a symlink necessary. The entry is a `.js` file,
 * not an executable; and it has to run on the SERVER's interpreter, never on whatever `node`
 * the Agent's shell happens to resolve — under the desktop app that interpreter is the
 * Electron binary, which runs a script only with `ELECTRON_RUN_AS_NODE` set.
 *
 * Rewritten at every boot, so a moved checkout is picked up by the next start; while a
 * server is running, a dist that moved out from under it has already broken the server
 * itself. With no entry to point at, an existing shim is REMOVED — a launcher pointing at a
 * path that is no longer there is worse than no `penguin` at all.
 */
import fs from "node:fs";
import path from "node:path";

/** `<root>/bin`, the directory the shim is written to and the Session puts on PATH. */
export function cliShimDir(root: string): string {
  return path.join(root, "bin");
}

/** What one boot's `ensureCliShim` did, for the line the server logs about it. */
export type CliShimResult =
  | { kind: "written"; dir: string; entry: string }
  /** No entry to point at; a shim left by an earlier boot was removed. */
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

export interface CliShimOptions {
  /** The interpreter the shim execs: this server's own. Default `process.execPath`. */
  execPath?: string;
  /**
   * Whether that interpreter is an Electron binary, which runs a plain script only with
   * `ELECTRON_RUN_AS_NODE=1` in the environment. Default: whether this process has one.
   */
  electron?: boolean;
  /** Default `process.platform`; decides whether the `.cmd` half is written. */
  platform?: NodeJS.Platform;
}

/** A string as one POSIX shell word: single-quoted, with each embedded quote spliced as `'\''`. */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * `<dir>/penguin` — the shim for every POSIX shell, Git Bash on Windows included (which is
 * the shell commands run in there, see core's shell resolver). `"$@"` forwards the
 * arguments one word each, and `exec` leaves the CLI as the process whose exit status the
 * caller reads.
 */
export function posixShimScript(execPath: string, entry: string, electron: boolean): string {
  return [
    "#!/bin/sh",
    "# penguin CLI shim, rewritten by the PenguinHarness server at every start.",
    "# Runs the CLI of the harness that serves this data root, on that server's own runtime.",
    ...(electron ? ["export ELECTRON_RUN_AS_NODE=1"] : []),
    `exec ${posixQuote(execPath)} ${posixQuote(entry)} "$@"`,
    "",
  ].join("\n");
}

/**
 * `<dir>\penguin.cmd` — the same shim for `cmd` and PowerShell. CRLF on purpose: cmd.exe is
 * unreliable with bare-LF scripts.
 */
export function windowsShimScript(execPath: string, entry: string, electron: boolean): string {
  return [
    "@echo off",
    "rem penguin CLI shim, rewritten by the PenguinHarness server at every start.",
    "rem Runs the CLI of the harness that serves this data root, on that server's own runtime.",
    "setlocal",
    ...(electron ? ['set "ELECTRON_RUN_AS_NODE=1"'] : []),
    `"${execPath}" "${entry}" %*`,
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");
}

/**
 * The CLI entry of the checkout this module was loaded from, or null when there is none.
 *
 * Walks up from `fromDir` to the directory holding `pnpm-workspace.yaml` — the workspace
 * root — rather than counting `..` segments, because the depth differs between a `tsx` run
 * (`packages/server/src/…`), a built one (`packages/server/dist/…`) and the desktop shell's
 * single-file bundle. Outside a checkout (an npm install, a packaged app) the walk reaches
 * the filesystem root and answers null, and so does a workspace that simply has not built
 * its CLI: a shim is only ever written for a file that is actually there.
 */
export function checkoutCliEntry(fromDir: string): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const entry = path.join(dir, "packages", "cli", "dist", "penguin.js");
      return fs.existsSync(entry) ? entry : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Writes (or removes) this data root's `penguin` shim. Never throws: a data root that
 * cannot be written is reported as a failure and leaves the server running — an Agent then
 * falls back to whatever `penguin` the machine has, which is where it started.
 */
export function ensureCliShim(
  root: string,
  entry: string | null,
  opts: CliShimOptions = {},
): CliShimResult {
  const dir = cliShimDir(root);
  const posix = path.join(dir, "penguin");
  const windows = path.join(dir, "penguin.cmd");
  try {
    if (entry === null) {
      // Both spellings, whatever this platform is: a data root is portable, and the stale
      // one to remove may have been written by a boot on the other OS.
      fs.rmSync(posix, { force: true });
      fs.rmSync(windows, { force: true });
      return { kind: "absent" };
    }
    const execPath = opts.execPath ?? process.execPath;
    const electron = opts.electron ?? process.versions.electron !== undefined;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(posix, posixShimScript(execPath, entry, electron), { mode: 0o755 });
    // Explicit: writeFileSync applies `mode` only when it creates the file, so a shim
    // rewritten over an earlier one would keep whatever bits that one had.
    fs.chmodSync(posix, 0o755);
    if ((opts.platform ?? process.platform) === "win32") {
      fs.writeFileSync(windows, windowsShimScript(execPath, entry, electron));
    }
    return { kind: "written", dir, entry };
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
