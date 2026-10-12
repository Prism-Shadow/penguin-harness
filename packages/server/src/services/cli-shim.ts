/**
 * The `penguin` a command an Agent runs, or a person types in one of this server's terminals,
 * should find: this harness's own CLI, talking to this harness — written into the data root as
 * a launcher script that every Session and every terminal puts at the front of PATH.
 *
 * Without it, `penguin` resolves against whatever the machine has installed globally — on a
 * development box that is the desktop app's bundled release, several versions away from the
 * checkout the server was started from, so an Agent asking its own harness to do something
 * gets `unknown command` for anything added since. The shim closes that gap without asking
 * the Agent to know any paths.
 *
 * The right code is half of it; the other half is the right server. The CLI finds its server
 * through a data root — `PENGUIN_HOME`, else `~/.penguin/data`, which is the INSTALLED
 * harness's — so a launcher that only picked the code would run this checkout's CLI against
 * the installed server. The launcher therefore names this data root as the default for the one
 * process it starts: `PENGUIN_HOME` is set there unless the caller already set one, which is
 * the caller's own choice (as `--root` and `--server` stay), and nothing is exported into the
 * shell that runs it — a terminal whose environment carried this root would hand it to every
 * `pnpm dev` typed there, over that script's own default.
 *
 * Three facts make the launcher rather than a symlink necessary: the entry is a script, not
 * an executable; it has to run on the SERVER's interpreter, never on whatever `node` the
 * shell happens to resolve — under the desktop app that interpreter is the Electron binary,
 * which runs a script only with `ELECTRON_RUN_AS_NODE` set; and the default above.
 *
 * Which CLI that is, is decided once per boot by {@link resolveCliLaunch}: an explicit
 * `PENGUIN_CLI_ENTRY` (what `penguin server|web` and the desktop shell pass for themselves),
 * else, for a server running from a checkout, that checkout's CLI — from source while the
 * server itself runs from source, so `pnpm dev` never offers a CLI older than the code it
 * serves.
 *
 * Rewritten at every boot, so a moved checkout is picked up by the next start; while a
 * server is running, a dist that moved out from under it has already broken the server
 * itself. With no entry to point at, an existing shim is REMOVED — a launcher pointing at a
 * path that is no longer there is worse than no `penguin` at all — except on a server that
 * runs from a checkout: there a CLI that cannot run is a development setup to fix, and the
 * shim is written as a stub that says what is missing rather than letting another
 * installation's `penguin` answer in its place.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** `<root>/bin`, the directory the shim is written to and the Session puts on PATH. */
export function cliShimDir(root: string): string {
  return path.join(root, "bin");
}

/**
 * Where an offered CLI comes from:
 * - `env`: `PENGUIN_CLI_ENTRY`, set by `penguin server|web` and the desktop shell to their own;
 * - `source`: the checkout's `packages/cli/src/penguin.ts`, run through its TypeScript loader;
 * - `build`: the checkout's `packages/cli/dist/penguin.js`.
 */
export type CliOrigin = "env" | "source" | "build";

/** How this server offers its CLI, decided once per boot by {@link resolveCliLaunch}. */
export interface CliLaunch {
  /** The script the shim runs, or null when there is none to run. */
  entry: string | null;
  /** Interpreter options the shim puts before `entry`: the TypeScript loader for a source run. */
  execArgs: string[];
  /** The checkout this server runs from — a development instance — or null for an installation. */
  checkout: string | null;
  /** Where `entry` came from; null when there is no entry. */
  origin: CliOrigin | null;
  /** Why a checkout's own CLI cannot be offered (`entry` is then null); null otherwise. */
  unavailable: string | null;
}

/** The checkout's CLI entries, relative to the workspace root. */
const SOURCE_ENTRY = ["packages", "cli", "src", "penguin.ts"] as const;
const BUILT_ENTRY = ["packages", "cli", "dist", "penguin.js"] as const;

/**
 * The workspace root of the checkout `fromDir` lies in — the directory holding
 * `pnpm-workspace.yaml` — or null outside one.
 *
 * Walks up rather than counting `..` segments, because the depth differs between a `tsx` run
 * (`packages/server/src/…`), a built one (`packages/server/dist/…`), the desktop shell's
 * single-file bundle, and a copy pnpm injected into another package's `node_modules`. Outside
 * a checkout (an npm install, a packaged app) the walk reaches the filesystem root.
 */
export function workspaceRoot(fromDir: string): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The TypeScript loader that runs a checkout's CLI from source, as the file URL `--import`
 * takes (a bare Windows path is not a valid specifier there): the `tsx` the CLI package itself
 * depends on, the same one its own `penguin` script runs through. Null when it does not
 * resolve — the checkout's dependencies are not installed.
 */
export function checkoutTsLoader(checkout: string): string | null {
  try {
    const require = createRequire(path.join(checkout, "packages", "cli", "package.json"));
    return pathToFileURL(require.resolve("tsx")).href;
  } catch {
    return null;
  }
}

export interface ResolveCliLaunchOptions {
  /** `PENGUIN_CLI_ENTRY` as the environment has it; blank counts as unset. */
  explicit: string | undefined;
  /** The directory of the server module asking: where the walk to a checkout starts. */
  moduleDir: string;
  /** Whether that module is TypeScript source — this server itself runs from source. */
  source: boolean;
  /** Whether this process is Electron, which runs no TypeScript loader. */
  electron: boolean;
  /** The loader lookup; default {@link checkoutTsLoader}. */
  tsLoader?: (checkout: string) => string | null;
}

/**
 * Which CLI this server offers as `penguin`, in this order:
 *
 * 1. `PENGUIN_CLI_ENTRY`, when set: whoever started the server named its own CLI.
 * 2. Outside a checkout, nothing: an installation that was not told its CLI has none to offer.
 * 3. In a checkout, that checkout's CLI. A server running from TypeScript source (`pnpm dev`
 *    runs it under `tsx watch`) offers the CLI's source through the checkout's loader: it is
 *    the CLI as the checkout is NOW, as the server is, where a build would be whatever was
 *    built at start and would miss every CLI edit and pull since. A built server — the desktop
 *    shell's bundle, `node packages/server/dist/index.js` — offers the built CLI, the same
 *    snapshot it is itself. Each falls back to the other; Electron runs no loader, so a server
 *    on it has the build only.
 * 4. A checkout with neither: no entry, and the reason, which the shim and every terminal then
 *    state instead of letting another installation's `penguin` stand in.
 */
export function resolveCliLaunch(opts: ResolveCliLaunchOptions): CliLaunch {
  const checkout = workspaceRoot(opts.moduleDir);
  const explicit = opts.explicit?.trim();
  if (explicit) {
    return { entry: explicit, execArgs: [], checkout, origin: "env", unavailable: null };
  }
  if (checkout === null) {
    return { entry: null, execArgs: [], checkout: null, origin: null, unavailable: null };
  }

  const sourceEntry = path.join(checkout, ...SOURCE_ENTRY);
  const builtEntry = path.join(checkout, ...BUILT_ENTRY);
  const fromSource = (): CliLaunch | null => {
    if (opts.electron || !fs.existsSync(sourceEntry)) return null;
    const loader = (opts.tsLoader ?? checkoutTsLoader)(checkout);
    if (loader === null) return null;
    const execArgs = ["--import", loader];
    return { entry: sourceEntry, execArgs, checkout, origin: "source", unavailable: null };
  };
  const fromBuild = (): CliLaunch | null =>
    fs.existsSync(builtEntry)
      ? { entry: builtEntry, execArgs: [], checkout, origin: "build", unavailable: null }
      : null;
  const found = opts.source ? (fromSource() ?? fromBuild()) : (fromBuild() ?? fromSource());
  if (found !== null) return found;
  const unbuilt = `${path.join(...BUILT_ENTRY)} is not built`;
  const why = opts.electron
    ? `${unbuilt} in ${checkout}`
    : `${unbuilt} in ${checkout}, and its source cannot run without tsx (pnpm install)`;
  return {
    entry: null,
    execArgs: [],
    checkout,
    origin: null,
    unavailable: `${why}. Run \`pnpm --filter @prismshadow/penguin-cli build\`, then restart the server.`,
  };
}

/** What one boot's `ensureCliShim` did, for the line the server logs about it. */
export type CliShimResult =
  | { kind: "written"; dir: string; entry: string; execArgs: string[] }
  /** A checkout's CLI cannot run: the shim is a stub that says why. */
  | { kind: "stub"; dir: string; reason: string }
  /** No entry to point at; a shim left by an earlier boot was removed. */
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

export interface CliShimOptions {
  /** Interpreter options before the entry (see CliLaunch.execArgs). Default none. */
  execArgs?: readonly string[];
  /**
   * Why a checkout's CLI cannot run (CliLaunch.unavailable). With no entry, a stub that says
   * so is written instead of removing the shim. Default null.
   */
  unavailable?: string | null;
  /** The server's database (ServerConfig.dbPath); named by the launcher only when not the root's default. */
  dbPath?: string;
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

/** What a launcher runs, and for which data root. */
export interface ShimLaunch {
  /** The data root the CLI targets unless its caller set `PENGUIN_HOME`. */
  root: string;
  /**
   * The server's database when it is not `<root>/web.db` (PENGUIN_WEB_DB), named along with the
   * root — the CLI reads it for `auth token` and `server status`. Absent or null: the default.
   */
  database?: string | null;
  execPath: string;
  execArgs?: readonly string[];
  entry: string;
  electron: boolean;
}

/**
 * The database a launcher names besides the root: `dbPath` unless it is the root's default
 * file, or a database no other process can open (`:memory:`). Named by its absolute path: the
 * server opened a relative PENGUIN_WEB_DB against its own working directory, and the CLI runs in
 * whichever directory it is called from.
 */
function nonDefaultDatabase(root: string, dbPath: string | undefined): string | null {
  if (dbPath === undefined || dbPath === ":memory:") return null;
  const file = path.resolve(dbPath);
  return file === path.resolve(root, "web.db") ? null : file;
}

/** A string as one POSIX shell word: single-quoted, with each embedded quote spliced as `'\''`. */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A path inside a cmd script: `%` would start a variable reference, `%%` is a literal one. */
function cmdLiteral(value: string): string {
  return value.replaceAll("%", "%%");
}

/**
 * `<dir>/penguin` — the shim for every POSIX shell, Git Bash on Windows included (which is
 * the shell commands run in there, see core's shell resolver). `"$@"` forwards the
 * arguments one word each, and `exec` leaves the CLI as the process whose exit status the
 * caller reads. The script is its own process, so the `PENGUIN_HOME` it sets reaches the CLI
 * and nothing else.
 */
export function posixShimScript(launch: ShimLaunch): string {
  const argv = [launch.execPath, ...(launch.execArgs ?? []), launch.entry].map(posixQuote);
  const database = launch.database ?? null;
  return [
    "#!/bin/sh",
    "# penguin CLI shim, rewritten by the PenguinHarness server at every start.",
    "# Runs the CLI of the harness that serves this data root, on that server's own runtime,",
    "# against this data root unless the caller set PENGUIN_HOME (or passes --root / --server).",
    'if [ -z "${PENGUIN_HOME-}" ]; then',
    `  PENGUIN_HOME=${posixQuote(launch.root)}; export PENGUIN_HOME`,
    ...(database !== null
      ? [`  PENGUIN_WEB_DB=${posixQuote(database)}; export PENGUIN_WEB_DB`]
      : []),
    "fi",
    ...(launch.electron ? ["export ELECTRON_RUN_AS_NODE=1"] : []),
    `exec ${argv.join(" ")} "$@"`,
    "",
  ].join("\n");
}

/**
 * `<dir>\penguin.cmd` — the same shim for `cmd` and PowerShell. CRLF on purpose: cmd.exe is
 * unreliable with bare-LF scripts. `setlocal` keeps the variables it sets to this script and
 * the CLI it starts.
 */
export function windowsShimScript(launch: ShimLaunch): string {
  const argv = [launch.execPath, ...(launch.execArgs ?? []), launch.entry].map(
    (part) => `"${cmdLiteral(part)}"`,
  );
  const database = launch.database ?? null;
  return [
    "@echo off",
    "rem penguin CLI shim, rewritten by the PenguinHarness server at every start.",
    "rem Runs the CLI of the harness that serves this data root, on that server's own runtime,",
    "rem against this data root unless the caller set PENGUIN_HOME (or passes --root / --server).",
    "setlocal",
    // The database first: once PENGUIN_HOME is set, the condition no longer holds.
    ...(database !== null
      ? [`if not defined PENGUIN_HOME set "PENGUIN_WEB_DB=${cmdLiteral(database)}"`]
      : []),
    `if not defined PENGUIN_HOME set "PENGUIN_HOME=${cmdLiteral(launch.root)}"`,
    ...(launch.electron ? ['set "ELECTRON_RUN_AS_NODE=1"'] : []),
    `${argv.join(" ")} %*`,
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");
}

/** The stub's message: one line, whatever the reason carried. */
function stubMessage(reason: string): string {
  return `penguin: this PenguinHarness instance cannot run its own CLI: ${reason.replace(/\s*[\r\n]+\s*/g, " ")}`;
}

/**
 * `<dir>/penguin` for a checkout whose CLI cannot run: it prints why and fails, so neither a
 * person nor an Agent gets another installation's `penguin` without being told. The heredoc's
 * quoted delimiter keeps the text literal.
 */
export function posixStubScript(reason: string): string {
  return [
    "#!/bin/sh",
    "# penguin CLI shim, rewritten by the PenguinHarness server at every start.",
    "# This server runs from a checkout whose CLI cannot run; rather than let another",
    "# installation's penguin answer in its place, the shim says why.",
    "cat >&2 <<'PENGUIN_SHIM_EOF'",
    stubMessage(reason),
    "PENGUIN_SHIM_EOF",
    "exit 1",
    "",
  ].join("\n");
}

/** The same stub for `cmd` and PowerShell; cmd's metacharacters escaped with `^`. */
export function windowsStubScript(reason: string): string {
  const text = cmdLiteral(stubMessage(reason)).replace(/[\^&|<>()]/g, "^$&");
  return [
    "@echo off",
    "rem penguin CLI shim, rewritten by the PenguinHarness server at every start.",
    "rem This server runs from a checkout whose CLI cannot run; the shim says why.",
    `>&2 echo ${text}`,
    "exit /b 1",
    "",
  ].join("\r\n");
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
  const onWindows = (opts.platform ?? process.platform) === "win32";
  const unavailable = opts.unavailable ?? null;
  try {
    if (entry === null) {
      if (unavailable === null) {
        // Both spellings, whatever this platform is: a data root is portable, and the stale
        // one to remove may have been written by a boot on the other OS.
        fs.rmSync(posix, { force: true });
        fs.rmSync(windows, { force: true });
        return { kind: "absent" };
      }
      fs.mkdirSync(dir, { recursive: true });
      writeExecutable(posix, posixStubScript(unavailable));
      if (onWindows) fs.writeFileSync(windows, windowsStubScript(unavailable));
      return { kind: "stub", dir, reason: unavailable };
    }
    fs.mkdirSync(dir, { recursive: true });
    const launch: ShimLaunch = {
      root,
      database: nonDefaultDatabase(root, opts.dbPath),
      execPath: opts.execPath ?? process.execPath,
      execArgs: opts.execArgs ?? [],
      entry,
      electron: opts.electron ?? process.versions.electron !== undefined,
    };
    writeExecutable(posix, posixShimScript(launch));
    if (onWindows) fs.writeFileSync(windows, windowsShimScript(launch));
    return { kind: "written", dir, entry, execArgs: [...(opts.execArgs ?? [])] };
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

function writeExecutable(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: 0o755 });
  // Explicit: writeFileSync applies `mode` only when it creates the file, so a shim
  // rewritten over an earlier one would keep whatever bits that one had.
  fs.chmodSync(file, 0o755);
}
