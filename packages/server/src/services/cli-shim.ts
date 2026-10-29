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
 * Which CLI that is, is decided once per boot: {@link resolveCliLaunch} names the installed
 * CLI — an explicit `PENGUIN_CLI_ENTRY` (what `penguin server|web` and the desktop shell
 * pass for themselves), else, for a server running from a checkout, that checkout's CLI,
 * from source while the server itself runs from source — and {@link resolveCli}, at the end
 * of this module, decides between that entry and the CLI loader — the entry that loads a
 * pushed CLI — which runs the same code this server runs. See {@link shimFromResolution}.
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
import fsp from "node:fs/promises";
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

/** The CLI this installation offers, before resolution has a say. */
export interface InstalledCli {
  /** The entry this server was told to offer, or null when it has none. */
  entry: string | null;
  /** Interpreter options before it (see CliLaunch.execArgs). */
  execArgs: readonly string[];
  /** Why a checkout's own CLI cannot run; null otherwise. */
  unavailable: string | null;
}

/** What the shim runs, and the name of resolution's answer it ran under. */
export interface ShimLaunchAnswer {
  entry: string | null;
  execArgs: string[];
  unavailable: string | null;
  /** The answer's name: a reason, a fault, or `no-entry` when there was nothing to ask about. */
  answer: CliReason | CliFault | "no-entry";
}

/**
 * The shim's entry, from resolution's answer.
 *
 * The shim carries the answer rather than deciding for itself: the loader a root with a
 * pushed CLI resolves to, the installed CLI for a root with no pushed one, and the
 * installed CLI with the fault recorded when resolution faults — a server that starts on
 * its installed CLI beats one that does not, and that fallback is now a named decision
 * instead of an accident. A loader is a plain file, so only the installed entry keeps the
 * interpreter options a source run needs.
 */
export function shimFromResolution(
  installed: InstalledCli,
  resolved: CliResolution | null,
): ShimLaunchAnswer {
  if (installed.entry === null || resolved === null) {
    return {
      entry: installed.entry,
      execArgs: [...installed.execArgs],
      unavailable: installed.unavailable,
      answer: "no-entry",
    };
  }
  if (resolved.kind === "fault") {
    return {
      entry: installed.entry,
      execArgs: [...installed.execArgs],
      unavailable: installed.unavailable,
      answer: resolved.fault,
    };
  }
  const same = resolved.entry === installed.entry;
  return {
    entry: resolved.entry,
    execArgs: same ? [...installed.execArgs] : [],
    unavailable: null,
    answer: resolved.reason,
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

// ---------------------------------------------------------------------------
// Resolution: which CLI entry runs
// ---------------------------------------------------------------------------

/**
 * Which entry runs a harness command, answered once for every consumer that runs one — this
 * shim, a server being re-spawned, a remote machine command, the push gate — and for the
 * CLI's own loader, which imports this module as `@prismshadow/penguin-server/cli-shim`.
 *
 * The question is small. A data root holds the record of its last push
 * (`hmr/harness.json`, PRFC-0023), and an installation ships a CLI. A pushed CLI is a bundle
 * the record points at, and a product ships a **CLI loader** that loads it. So: the CLI
 * loader when a CLI was pushed, the caller's own entry when nothing was, and a named fault
 * when the pieces do not line up.
 *
 * The loader's identity is a declaration in its package manifest:
 *
 *     "penguin": { "cliLoader": "./dist/penguin-hmr.js" }
 *
 * A rename that keeps the field works. A field that names nothing usable answers one named
 * fault. Products built before the declaration carry none, and only there does the old file
 * name answer — recorded as `legacy` while the transition window lasts.
 */

/** The loader's file name in products built before the declaration (the transition window). */
export const LEGACY_LOADER_NAME = "penguin-hmr.js";

/** The six faults a consumer can report, in the RFC's order. */
export const CLI_FAULTS = [
  "damaged-record",
  "cli-pointer-unusable",
  "cli-bundle-missing",
  "loader-missing",
  "loader-absent",
  "loader-unloadable",
] as const;

export type CliFault = (typeof CLI_FAULTS)[number];

/** The four reasons an entry can be the answer. */
export const CLI_REASONS = ["pushed", "legacy", "no-record", "no-pushed-cli"] as const;

export type CliReason = (typeof CLI_REASONS)[number];

/**
 * Resolution's answer: one entry — with the pushed bundle when the record holds one — or one
 * named fault. A supervisor runs `entry`; a loader loads `bundle`; both record the name.
 */
export type CliResolution =
  | {
      kind: "entry";
      /** The entry to run: the product's loader, the legacy loader, or the caller's own. */
      entry: string;
      reason: CliReason;
      /** The pushed CLI bundle the record names; null when nothing is pushed. */
      bundle: string | null;
    }
  | { kind: "fault"; fault: CliFault; detail: string };

/** What `<root>/hmr/harness.json` says about the pushed CLI, in the five states that differ. */
type CliRecord =
  | { state: "none" }
  | { state: "damaged"; detail: string }
  | { state: "absent" }
  | { state: "unusable"; detail: string }
  | { state: "missing"; file: string }
  | { state: "bundle"; file: string };

/**
 * Reads the record's CLI half into those states. Never throws: a record a reader cannot act
 * on is one of the answers, because every caller has to say something useful either way.
 *
 * `cli.bundle` is written only by the hot-update layer, but a reader still keeps a malformed
 * value from walking out of the store with `..`: an escape is `unusable`, like a pointer
 * that names nothing.
 */
async function readCliRecord(root: string): Promise<CliRecord> {
  const file = path.join(root, "hmr", "harness.json");
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "none" };
    return { state: "damaged", detail: `${file} could not be read: ${messageOf(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: "damaged", detail: `${file} is not readable JSON: ${messageOf(err)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: "damaged", detail: `${file} does not hold a JSON object` };
  }
  const cli: unknown = (parsed as Record<string, unknown>).cli;
  if (cli === undefined) return { state: "absent" };
  const bundle: unknown =
    typeof cli === "object" && cli !== null ? (cli as { bundle?: unknown }).bundle : undefined;
  if (typeof bundle !== "string" || bundle.length === 0) {
    return { state: "unusable", detail: `harness.json has a \`cli\` entry with no bundle path` };
  }
  const hmrDir = path.join(root, "hmr");
  const abs = path.resolve(hmrDir, bundle);
  if (abs !== hmrDir && !abs.startsWith(hmrDir + path.sep)) {
    return {
      state: "unusable",
      detail: `harness.json points \`cli.bundle\` outside ${hmrDir}: ${bundle}`,
    };
  }
  if (!fs.existsSync(abs)) return { state: "missing", file: abs };
  return { state: "bundle", file: abs };
}

/** What a product's package manifest says about its loader: a file, nothing, or something broken. */
type LoaderDeclaration =
  | { state: "declared"; file: string }
  /** No manifest to ask, or one from before the declaration. */
  | { state: "absent" }
  /** A declaration that names no usable loader: a named fault, never a fallback. */
  | { state: "broken"; detail: string };

/**
 * The declaration of the product that owns `entry`: the nearest package manifest above it,
 * read after resolving symlinks, because a bin link or a `PATH` entry names the file whose
 * package carries the declaration. The walk stops at that manifest whether it declares a
 * loader or not — a product must not inherit the declaration of the directory above it.
 */
async function loaderDeclarationFor(entry: string): Promise<LoaderDeclaration> {
  let dir = path.dirname(await realPathOf(entry));
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) return readLoaderDeclaration(manifest);
    const parent = path.dirname(dir);
    if (parent === dir) return { state: "absent" };
    dir = parent;
  }
}

/** Reads one package manifest's `penguin.cliLoader` field. */
async function readLoaderDeclaration(manifest: string): Promise<LoaderDeclaration> {
  let raw: string;
  try {
    raw = await fsp.readFile(manifest, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent" };
    return { state: "broken", detail: `${manifest} could not be read: ${messageOf(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: "broken", detail: `${manifest} is not readable JSON: ${messageOf(err)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: "broken", detail: `${manifest} does not hold a JSON object` };
  }
  const namespace = (parsed as Record<string, unknown>).penguin;
  if (namespace === undefined || namespace === null) return { state: "absent" };
  if (typeof namespace !== "object" || Array.isArray(namespace)) {
    return { state: "broken", detail: `${manifest}: \`penguin\` is not an object` };
  }
  const declared = (namespace as Record<string, unknown>).cliLoader;
  if (declared === undefined || declared === null) return { state: "absent" };
  if (typeof declared !== "string" || declared.trim().length === 0) {
    return { state: "broken", detail: `${manifest}: \`penguin.cliLoader\` names no file` };
  }
  const dir = path.dirname(manifest);
  const file = path.resolve(dir, declared);
  // A declaration names a path inside its own product: one that climbs out names some other
  // installation's file, which is worse than naming none.
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    return {
      state: "broken",
      detail: `${manifest}: \`penguin.cliLoader\` points outside ${dir}: ${declared}`,
    };
  }
  return { state: "declared", file };
}

/**
 * Which entry runs this command, in the RFC's fixed order. The first case that applies
 * decides; the answer carries its reason or its fault name.
 *
 * 1. A pushed CLI, and the caller is its product's loader: the caller itself, `pushed` (or
 *    `legacy` for a product from before the declaration). A loader never loads itself; the
 *    bundle it loads rides along.
 * 2. A pushed CLI, and the product declares a loader: that loader, `pushed` — or the fault
 *    `loader-missing` when the declaration names no present file, broken included.
 * 3. A pushed CLI, no declaration, the legacy loader beside the caller: it, `legacy`.
 * 4. A pushed CLI, no declaration, no legacy loader: fault `loader-absent`.
 * 5. No record: the caller's own entry, `no-record`.
 * 6. A record with no CLI section: the caller's own entry, `no-pushed-cli`.
 * 7. A damaged record, an unusable pointer, a pointer the store lost: that fault.
 */
export async function resolveCli(input: {
  /** The caller's own entry, absolute: what this process runs, or the entry it offers. */
  self: string;
  /** The data root whose record says whether a CLI was pushed here. */
  root: string;
  /** Whether the transition window is open. Default true. */
  legacyWindow?: boolean;
}): Promise<CliResolution> {
  const self = path.resolve(input.self);
  const declaration = await loaderDeclarationFor(self);
  const record = await readCliRecord(path.resolve(input.root));
  const declared = declaration.state === "declared" ? declaration.file : null;

  if (record.state === "bundle") {
    // 1. The caller is the loader: it answers itself, and the bundle says what it loads.
    if (declared !== null ? await sameFile(self, declared) : isLegacyName(self, declaration)) {
      return {
        kind: "entry",
        entry: self,
        reason: declared !== null ? "pushed" : "legacy",
        bundle: record.file,
      };
    }
    // 2, 3. The product's declared loader, present or not.
    if (declared !== null) {
      return isFile(declared)
        ? { kind: "entry", entry: declared, reason: "pushed", bundle: record.file }
        : { kind: "fault", fault: "loader-missing", detail: `${declared} is not present` };
    }
    if (declaration.state === "broken") {
      return { kind: "fault", fault: "loader-missing", detail: declaration.detail };
    }
    // 4, 5. The legacy name, only where no declaration exists.
    if (input.legacyWindow !== false) {
      const legacy = path.join(path.dirname(self), LEGACY_LOADER_NAME);
      if (isFile(legacy)) {
        return { kind: "entry", entry: legacy, reason: "legacy", bundle: record.file };
      }
    }
    return {
      kind: "fault",
      fault: "loader-absent",
      detail: `no loader is declared above ${path.dirname(self)}`,
    };
  }

  // 6, 7. Nothing pushed: the caller's own entry is the answer, named for why.
  if (record.state === "none")
    return { kind: "entry", entry: self, reason: "no-record", bundle: null };
  if (record.state === "absent") {
    return { kind: "entry", entry: self, reason: "no-pushed-cli", bundle: null };
  }
  // 8. The record is there and cannot be used: a named fault.
  if (record.state === "damaged") {
    return { kind: "fault", fault: "damaged-record", detail: record.detail };
  }
  if (record.state === "unusable") {
    return { kind: "fault", fault: "cli-pointer-unusable", detail: record.detail };
  }
  return { kind: "fault", fault: "cli-bundle-missing", detail: record.file };
}

/** Whether the caller is the legacy loader of a product that declares nothing. */
function isLegacyName(self: string, declaration: LoaderDeclaration): boolean {
  return declaration.state === "absent" && path.basename(self) === LEGACY_LOADER_NAME;
}

/** A file that is really there: a directory named like the loader names no loader. */
function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Whether two entries name the same file, through symlinks and relative spellings. */
async function sameFile(a: string, b: string): Promise<boolean> {
  if (path.resolve(a) === path.resolve(b)) return true;
  return (await realPathOf(a)) === (await realPathOf(b));
}

/** The real path of a file that exists; the plain absolute path otherwise. */
async function realPathOf(file: string): Promise<string> {
  const abs = path.resolve(file);
  try {
    return await fsp.realpath(abs);
  } catch {
    return abs;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
