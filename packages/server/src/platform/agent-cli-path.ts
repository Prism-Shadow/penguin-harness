/**
 * Puts the packaged app's `bin/` (the `penguin` / `penguin.cmd` launcher staged by
 * packages/desktop/scripts/stage.mjs) onto process.env.PATH, so shells the agent spawns
 * can find the `penguin` CLI.
 *
 * Why this exists: "install the `penguin` command" only edits OS-level PATH (Windows
 * writes HKCU\Environment\Path, macOS/AppImage drop a symlink into a bin directory
 * already on PATH) — and that only reaches processes started AFTER the edit. The
 * already-running embedded server never sees it, so the agent's shell tool (which
 * inherits the server process's own process.env) never finds `penguin` either. Extending
 * PATH here, in-process at platform boot, fixes both the packaged default boot and
 * already-deployed machines the moment a platform bundle is pushed to them.
 *
 * See ../hmr/README.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The path implementation to parse candidate strings with, chosen by the *simulated*
 * platform rather than the ambient `node:path` (which follows the real host OS). In
 * production these are identical — Node's `path` already delegates to `path.win32` on a
 * real Windows host — so this only decouples tests from the OS they happen to run on,
 * letting Windows-shaped candidate strings be exercised deterministically on any CI box.
 */
function pathImplFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Walks up from `filePath` looking for `.../node_modules/@prismshadow/penguin-server`
 * (three basenames: `penguin-server`, `@prismshadow`, `node_modules`) and returns the
 * directory three levels above the match — the packaged app directory the server
 * package is staged inside. Returns null if the walk reaches the filesystem root
 * without a match (e.g. any non-packaged layout: dev checkouts, npm-global installs).
 *
 * Deliberately tail-shape-agnostic (works whether `filePath` is
 * `dist/index.js` or `dist/platform/agent-cli-path.js` below the package root) so one
 * function serves both the process-entry and the module's-own-file candidates below.
 */
function appDirFromInstalledPath(
  filePath: string | undefined,
  p: path.PlatformPath,
): string | null {
  if (!filePath) return null;
  let dir = p.dirname(filePath);
  for (;;) {
    if (
      p.basename(dir) === "penguin-server" &&
      p.basename(p.dirname(dir)) === "@prismshadow" &&
      p.basename(p.dirname(p.dirname(dir))) === "node_modules"
    ) {
      return p.dirname(p.dirname(p.dirname(dir)));
    }
    const parent = p.dirname(dir);
    if (parent === dir) return null; // reached root without a match
    dir = parent;
  }
}

/**
 * appDir from PENGUIN_BUNDLED_SHELL, the Windows-only env var packages/desktop's
 * server-process.ts sets to `<resourcesPath>/git/usr/bin/sh.exe` when it forks the
 * server. Like argv[1] below, an env var is stable for the process's whole lifetime, so
 * this is unaffected by a hot-pushed platform bundle running from a different disk
 * location than the packaged install. windowsLauncherScript's own comment records the
 * sibling geometry this relies on: bin -> app -> resources -> install root, i.e. the CLI
 * bin dir is `<resourcesPath>/app/bin`.
 */
function appDirFromBundledShell(shPath: string | undefined, p: path.PlatformPath): string | null {
  if (!shPath) return null;
  const gitDir = p.dirname(p.dirname(p.dirname(shPath))); // sh.exe -> bin -> usr -> git
  if (p.basename(gitDir) !== "git") return null;
  return p.join(p.dirname(gitDir), "app");
}

/**
 * appDir from process.execPath, per platform's packaged layout (mirrors
 * posixLauncherScript / windowsLauncherScript's own relative-path math, in reverse).
 * Needs real-machine confirmation (see the task report): Electron's utilityProcess fork
 * may run the server through a distinct signed helper binary on macOS (e.g. under
 * Contents/Frameworks/) rather than the app's own main executable, in which case this
 * candidate simply fails its existence check and falls through — never a hard error.
 */
function appDirFromExecPath(
  execPath: string,
  platform: NodeJS.Platform,
  p: path.PlatformPath,
): string | null {
  if (platform === "darwin") {
    // <bundle>/Contents/MacOS/PenguinHarness -> <bundle>/Contents/Resources/app
    const contents = p.dirname(p.dirname(execPath));
    if (p.basename(contents) !== "Contents") return null;
    return p.join(contents, "Resources", "app");
  }
  if (platform === "win32" || platform === "linux") {
    // <installRoot>/PenguinHarness.exe (win) or <installRoot>/penguin-harness (linux)
    // -> <installRoot>/resources/app
    return p.join(p.dirname(execPath), "resources", "app");
  }
  return null;
}

/** Injectable seams so the candidate chain can be exercised without a real packaged install. */
export interface FindCliBinDirDeps {
  fileExists?: (p: string) => boolean;
  platform?: NodeJS.Platform;
  execPath?: string;
  argv1?: string | undefined;
  bundledShell?: string | undefined;
  /**
   * This module's own resolved file path (i.e. `fileURLToPath(import.meta.url)`), not a
   * `file://` URL — `fileURLToPath` itself follows the real host OS's URL rules (e.g. it
   * throws on Windows for a driveless POSIX-shaped URL), so tests that simulate a
   * platform other than the one actually running the suite inject an already-resolved
   * path here instead of a URL.
   */
  modulePath?: string;
}

/**
 * Locates the packaged app's CLI `bin/` directory, trying candidates in order and
 * returning the first whose launcher file (`penguin` / `penguin.cmd`) actually exists.
 * Each candidate covers a different execution shape:
 *
 *  1. process.argv[1] — the path the server process was forked with, always the
 *     packaged `.../penguin-server/dist/index.js` regardless of what platform bundle is
 *     dynamically imported later. Covers a hot-pushed bundle running from
 *     $PENGUIN_HOME/hmr/store as well as the normal packaged boot, on every OS.
 *  2. This module's own import.meta.url — covers the packaged original position
 *     (`.../penguin-server/dist/platform/agent-cli-path.js`). Redundant with #1 in the
 *     common case; a fallback if #1's shape ever changes.
 *  3. PENGUIN_BUNDLED_SHELL's neighborhood — Windows only, independent of any module's
 *     file location (env var, not a path derived from `import.meta` or argv).
 *  4. process.execPath's neighborhood — per-platform fallback; see
 *     appDirFromExecPath's own doc comment for the macOS caveat.
 *
 * Returns null (never throws) when nothing matches — the normal case for dev runs and
 * any non-packaged environment.
 */
export function findCliBinDir(deps: FindCliBinDirDeps = {}): string | null {
  const fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
  const platform = deps.platform ?? process.platform;
  const execPath = deps.execPath ?? process.execPath;
  const argv1 = deps.argv1 ?? process.argv[1];
  const bundledShell = deps.bundledShell ?? process.env.PENGUIN_BUNDLED_SHELL;
  const modulePath = deps.modulePath ?? fileURLToPath(import.meta.url);

  const p = pathImplFor(platform);
  const launcherName = platform === "win32" ? "penguin.cmd" : "penguin";
  const candidateAppDirs = [
    appDirFromInstalledPath(argv1, p),
    appDirFromInstalledPath(modulePath, p),
    platform === "win32" ? appDirFromBundledShell(bundledShell, p) : null,
    appDirFromExecPath(execPath, platform, p),
  ];

  for (const appDir of candidateAppDirs) {
    if (appDir === null) continue;
    const binDir = p.join(appDir, "bin");
    if (fileExists(p.join(binDir, launcherName))) return binDir;
  }
  return null;
}

/** Case-insensitively finds the existing PATH-like key in `env` (Windows: usually "Path"). */
function findPathKey(env: NodeJS.ProcessEnv): string {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") return key;
  }
  return "PATH";
}

/** Trailing-slash-normalized comparison value; case folded only where the platform's own filesystem is. */
function normalizeForCompare(entry: string, platform: NodeJS.Platform): string {
  const trimmed = entry.trim().replace(/[\\/]+$/, "");
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/**
 * Idempotently prepends `dir` to `env`'s PATH-like entry (in place), reusing whichever
 * key already exists case-insensitively (never adds a second, conflicting "PATH" key
 * alongside Windows's real "Path") and comparing existing entries case-insensitively
 * only on win32, where the filesystem itself is. No-ops if `dir` is already present.
 */
export function prependToPath(
  env: NodeJS.ProcessEnv,
  dir: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const key = findPathKey(env);
  const delimiter = platform === "win32" ? ";" : ":";
  const current = env[key] ?? "";
  const target = normalizeForCompare(dir, platform);
  const alreadyPresent = current
    .split(delimiter)
    .some((entry) => entry !== "" && normalizeForCompare(entry, platform) === target);
  if (alreadyPresent) return;
  env[key] = current === "" ? dir : `${dir}${delimiter}${current}`;
}

/**
 * Finds the packaged CLI bin dir and prepends it to `env`'s PATH, if found. No-op (never
 * throws) when the packaged layout can't be located — normal for dev runs. Call once at
 * platform boot; see platform.ts's create() for why this is a platform responsibility.
 */
export function ensureCliOnPath(env: NodeJS.ProcessEnv = process.env): void {
  const binDir = findCliBinDir();
  if (binDir !== null) prependToPath(env, binDir, process.platform);
}
