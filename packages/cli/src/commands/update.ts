/**
 * `penguin update` — upgrades an existing install in place.
 *
 *   penguin update [--check] [--release <tag>] [-y|--yes]
 *
 * There is no single upgrade mechanism, because there is no single install mechanism: the
 * documented path is the tarball installer (install.sh unpacks bin/lib/web/node into
 * PENGUIN_INSTALL_DIR, default ~/.penguin), some users have a global npm install of
 * @prismshadow/penguin-cli, and developers run out of a source checkout. This command works out
 * which one it is from the real path of the running CLI and upgrades the way that install was
 * made — never by guessing. A source checkout is refused outright: overwriting a working tree
 * would destroy uncommitted work.
 *
 * The latest version comes from the GitHub Releases API, the same source of truth install.sh
 * resolves `releases/latest/download` against. The target-a-specific-release flag is spelled
 * `--release <tag>` rather than `--version <tag>`: commander's program-level `-v, --version`
 * intercepts a subcommand's own `--version` when it is written with a space, so
 * `penguin update --version 0.1.2` would silently print the CLI version and do nothing. A flag
 * that works only in its `--version=0.1.2` form is a trap, so it got an unambiguous name.
 *
 * Self-replacement hazard, and how it is handled: for a tarball install the installer deletes and
 * replaces `lib/`, which is the directory this very process is executing from. Two things make
 * that safe. (1) The upgrade runs in a child `sh`, from a script written to a private temporary
 * directory — not inside the tree being replaced — so the script itself is never pulled out from
 * under its own interpreter. (2) The parent does nothing after the swap begins that would touch
 * the replaced tree: every module it needs is statically imported at the top of the bundle and
 * therefore fully loaded before any action runs, every message it will print is resolved up front,
 * and after the child exits it only removes its own temp directory, writes already-computed
 * strings and sets an exit code. It never `import()`s anything (the CLI's only dynamic import is
 * `@prismshadow/penguin-server`, reachable solely from the serve commands), and never re-reads a
 * file. On POSIX an unlinked file stays valid for whoever has it open, so the running process is
 * unaffected.
 *
 * Where the installer script is written, and why it matters: `tmpdir()` is world-writable and
 * shared, so a fixed or guessable name there is a local privilege-escalation primitive — another
 * user can pre-create the path as a symlink and have this process overwrite a file it owns, or
 * swap the file between the write and the `spawn`, turning the upgrade into arbitrary code
 * execution as the invoking user. The script therefore goes into a fresh `mkdtempSync` directory:
 * created 0700 with an unpredictable name, so no one else can name the path in advance, and the
 * file is written with `wx` so an existing entry is an error rather than a silent truncation. The
 * directory is removed only after the child `sh` has exited (see the note at the call site).
 *
 * Windows never reaches either upgrade path. The tarball installer is a POSIX shell script; and a
 * global npm/pnpm/yarn/bun install cannot be driven from here either, because `spawn` without a
 * shell does no PATHEXT resolution and Node has refused to exec `.cmd` shims without one since the
 * CVE-2024-27980 fix. Rather than fall through to a generic failure — or spawn through `cmd.exe`,
 * which would interpolate a user-supplied release tag into a command line — both cases are refused
 * up front with the command the user should run themselves.
 *
 * The data root (~/.penguin/data) is never touched — the installer only replaces bin/lib/web/node
 * — and the confirmation prompt says so, because that is the thing users worry about.
 * Docs: /docs/cli § "penguin update".
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { VERSION } from "@prismshadow/penguin-core";
import type { Command } from "commander";
import type { Messages } from "../i18n.js";

/** Repository the released artifacts come from — the same repo install.sh downloads from. */
export const REPO_SLUG = "Prism-Shadow/penguin-harness";
/** Releases API endpoint for the newest published release. */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

/** How this copy of the CLI was installed, which decides how it can be upgraded. */
export type InstallKind = "tarball" | "npm" | "source" | "unknown";

export interface InstallInfo {
  kind: InstallKind;
  /** Tarball only: the install dir that holds bin/lib/web/node (i.e. PENGUIN_INSTALL_DIR). */
  installDir?: string;
  /** npm only: the global `node_modules` root that owns the package, used to identify the manager. */
  globalRoot?: string;
}

/** Global-install package managers we can drive; `null` means "tell the user, do not guess". */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** Splits a path into segments on either separator, so the same logic works for win32 paths. */
function segments(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean);
}

/**
 * Works out how this CLI was installed from the resolved real path of its own module.
 *
 * Pure and shape-based on purpose: it touches neither the filesystem nor the environment beyond
 * what is passed in, so every branch is unit-testable. The three layouts are unambiguous:
 *
 * - source checkout — `…/packages/cli/{src,dist}/index.{ts,js}` (also how a `pnpm link`-ed dev
 *   build looks once the bin symlink is resolved);
 * - npm global — the path runs through `node_modules/@prismshadow/penguin-cli/`;
 * - tarball — `<installDir>/lib/dist/index.js`, the layout install.sh unpacks.
 *
 * Order matters: a checkout is checked first so a repo that happens to live under a directory
 * called `lib` cannot be mistaken for an install.
 */
export function detectInstall(modulePath: string): InstallInfo {
  const parts = segments(modulePath);
  const sep = modulePath.includes("\\") && !modulePath.includes("/") ? "\\" : path.sep;
  const join = (upto: number) => {
    const joined = parts.slice(0, upto).join(sep);
    return modulePath.startsWith("/") ? `${sep}${joined}` : joined;
  };

  // …/packages/cli/(src|dist)/index.(ts|js)
  const cliIdx = parts.findIndex(
    (seg, i) => seg === "packages" && parts[i + 1] === "cli" && i + 2 < parts.length,
  );
  if (cliIdx >= 0 && (parts[cliIdx + 2] === "src" || parts[cliIdx + 2] === "dist")) {
    return { kind: "source" };
  }

  // …/node_modules/@prismshadow/penguin-cli/…
  const nmIdx = parts.findIndex(
    (seg, i) =>
      seg === "node_modules" && parts[i + 1] === "@prismshadow" && parts[i + 2] === "penguin-cli",
  );
  if (nmIdx >= 0) {
    return { kind: "npm", globalRoot: join(nmIdx + 1) };
  }

  // <installDir>/lib/dist/index.js
  if (parts.length >= 3) {
    const [lib, dist] = [parts[parts.length - 3], parts[parts.length - 2]];
    if (lib === "lib" && dist === "dist") {
      return { kind: "tarball", installDir: join(parts.length - 3) };
    }
  }

  return { kind: "unknown" };
}

/**
 * Identifies the package manager that owns a global `node_modules` root, from the root's own path.
 * Returns null when it is not recognizable — the caller then prints the command for the user to
 * run rather than guessing, because an `npm i -g` over a pnpm-managed install leaves two copies
 * and a broken shim.
 */
export function detectPackageManager(globalRoot: string): PackageManager | null {
  const parts = segments(globalRoot).map((s) => s.toLowerCase());
  if (parts.includes(".pnpm") || (parts.includes("pnpm") && parts.includes("global")))
    return "pnpm";
  if (parts.includes(".bun")) return "bun";
  if (parts.includes("yarn") && parts.includes("global")) return "yarn";
  if (parts.includes("npm") || parts.includes("lib") || parts.includes("node_modules"))
    return "npm";
  return null;
}

/** The global-install command for a manager, at a specific version. */
export function globalInstallCommand(
  manager: PackageManager,
  version: string,
): { command: string; args: string[] } {
  const spec = `@prismshadow/penguin-cli@${version}`;
  if (manager === "pnpm") return { command: "pnpm", args: ["add", "-g", spec] };
  if (manager === "yarn") return { command: "yarn", args: ["global", "add", spec] };
  if (manager === "bun") return { command: "bun", args: ["add", "-g", spec] };
  return { command: "npm", args: ["install", "-g", spec] };
}

/** Strips a leading `v` so `v0.1.2` and `0.1.2` are the same input. */
export function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

/**
 * Compares two dotted numeric versions: -1 / 0 / 1.
 *
 * Each dot-separated component is read with `Number.parseInt`, which takes the leading digits and
 * ignores the rest: `1abc` is 1, and `2-rc1` is 2. A component with no leading digit at all, or
 * one that is missing entirely, counts as 0 — which is the property that matters, because it means
 * a malformed or truncated tag can never make an upgrade look available.
 *
 * The consequence, stated rather than papered over: suffixes are invisible here, so `0.1.2-rc1`
 * compares *equal* to `0.1.2`. This project tags plain `vX.Y.Z` releases only, and the API this
 * reads (`tag_name` from GitHub Releases) returns those tags, so the case does not arise; carrying
 * a full semver precedence implementation — with its own numeric-vs-alphanumeric identifier rules
 * — to handle tags we do not publish would be more code and more ways to be wrong. If pre-release
 * tags are ever published, this has to become a real semver compare before `--release` can target
 * one.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    normalizeVersion(v)
      .split(".")
      .map((n) => Number.parseInt(n, 10));
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const l = Number.isFinite(x[i]) ? (x[i] as number) : 0;
    const r = Number.isFinite(y[i]) ? (y[i] as number) : 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * Builds the argv and environment for re-running install.sh, preserving the shape of the install
 * being upgraded rather than the defaults:
 *
 * - `PENGUIN_INSTALL_DIR` is passed whenever the install is not at the default `~/.penguin`, or
 *   the upgrade would silently relocate it;
 * - `--universal` is passed when the current install has no bundled `node/` directory, or the user
 *   would silently gain a runtime they deliberately did not install (and lose it in reverse);
 * - `PENGUIN_VERSION` pins the target when `--release` was given.
 *
 * Pure so every combination is unit-testable; the caller supplies the two facts that need the
 * filesystem (`installDir`, `hasBundledNode`).
 */
export function buildInstallerInvocation(opts: {
  scriptPath: string;
  installDir: string;
  hasBundledNode: boolean;
  defaultInstallDir: string;
  version?: string;
}): { args: string[]; env: Record<string, string> } {
  const args = [opts.scriptPath];
  if (!opts.hasBundledNode) args.push("--universal");
  const env: Record<string, string> = {};
  if (path.resolve(opts.installDir) !== path.resolve(opts.defaultInstallDir)) {
    env.PENGUIN_INSTALL_DIR = opts.installDir;
  }
  if (opts.version) env.PENGUIN_VERSION = `v${normalizeVersion(opts.version)}`;
  return { args, env };
}

/** Download URL for the installer of a given release (latest when no version is pinned). */
export function installerUrl(version?: string): string {
  const base = `https://github.com/${REPO_SLUG}/releases`;
  return version
    ? `${base}/download/v${normalizeVersion(version)}/install.sh`
    : `${base}/latest/download/install.sh`;
}

/**
 * Resolves the newest published version from the Releases API. Every failure mode the API actually
 * produces gets its own message instead of a stack trace: no network, a rate-limited 403 (which
 * arrives with no useful body from an unauthenticated client), any other HTTP status, and a body
 * that parses but carries no usable `tag_name`.
 */
export async function fetchLatestVersion(t: Messages): Promise<string> {
  let res: Response;
  try {
    res = await fetch(LATEST_RELEASE_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "penguin-cli" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(t.update.networkFailed(LATEST_RELEASE_API));
  }
  if (res.status === 403 || res.status === 429) throw new Error(t.update.rateLimited());
  if (!res.ok) throw new Error(t.update.apiFailed(res.status));
  let tag: unknown;
  try {
    tag = ((await res.json()) as { tag_name?: unknown }).tag_name;
  } catch {
    throw new Error(t.update.apiMalformed());
  }
  if (typeof tag !== "string" || normalizeVersion(tag) === "")
    throw new Error(t.update.apiMalformed());
  return normalizeVersion(tag);
}

/** Interactive y/N confirmation; SIGINT and stream close both count as "no", so it can never hang. */
function confirmYes(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      process.off("SIGINT", onSigint);
      rl.close();
      resolve(value);
    };
    const onSigint = () => finish(false);
    process.once("SIGINT", onSigint);
    rl.on("close", () => finish(false));
    rl.question(prompt, (answer) => finish(/^y(es)?$/i.test(answer.trim())));
  });
}

/** Runs a child process to completion, inheriting stdio; resolves with its exit code. */
function run(command: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

/** The real path of this module, with the ~/.local/bin/penguin symlink resolved. */
function selfPath(): string {
  const p = fileURLToPath(import.meta.url);
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * What the command decided to do, once the two versions and the install layout are known.
 *
 * `report` and `up-to-date` change nothing; `refuse` prints a reason and stops; `npm` and
 * `tarball` are the only two that go on to confirm and spawn anything.
 */
export type UpdatePlan =
  | { action: "report"; current: string; target: string; comparison: number }
  | { action: "up-to-date"; current: string }
  | { action: "refuse"; reason: "source" }
  | { action: "refuse"; reason: "unknown-install"; modulePath: string }
  | { action: "refuse"; reason: "unknown-manager"; globalRoot: string; target: string }
  | { action: "refuse"; reason: "windows-global"; command: string }
  | { action: "refuse"; reason: "windows-installer" }
  | { action: "npm"; manager: PackageManager; command: string; args: string[] }
  | { action: "tarball"; installDir: string };

/**
 * The whole decision, as one pure function: which of the outcomes above this invocation is, given
 * the running version, the resolved target, the flags, and the layout this CLI was installed as.
 *
 * Everything that needs the outside world stays with the caller — resolving the latest version,
 * probing for a bundled `node/`, prompting, spawning — so each branch below (including the two
 * refusals that exist only to avoid a misleading failure) is directly testable without a network
 * or a child process. The order is deliberate: `--check` reports and never upgrades, an install
 * already on the target is done before its layout even matters, a source checkout and an
 * unrecognised layout are refused before anything is downloaded, and Windows is refused inside
 * whichever branch applies so its message can name the command that would have run.
 */
export function planUpdate(input: {
  current: string;
  target: string;
  check?: boolean;
  install: InstallInfo;
  modulePath: string;
  platform: string;
  /** `~/.penguin`, passed in rather than read, so the tarball branch stays pure. */
  defaultInstallDir: string;
}): UpdatePlan {
  const { current, target, install } = input;
  const comparison = compareVersions(target, current);

  if (input.check) return { action: "report", current, target, comparison };
  if (comparison === 0) return { action: "up-to-date", current };

  if (install.kind === "source") return { action: "refuse", reason: "source" };
  if (install.kind === "unknown")
    return { action: "refuse", reason: "unknown-install", modulePath: input.modulePath };

  if (install.kind === "npm") {
    const globalRoot = install.globalRoot ?? "";
    const manager = detectPackageManager(globalRoot);
    if (!manager) return { action: "refuse", reason: "unknown-manager", globalRoot, target };
    const { command, args } = globalInstallCommand(manager, target);
    if (input.platform === "win32")
      return {
        action: "refuse",
        reason: "windows-global",
        command: `${command} ${args.join(" ")}`,
      };
    return { action: "npm", manager, command, args };
  }

  if (input.platform === "win32") return { action: "refuse", reason: "windows-installer" };
  return { action: "tarball", installDir: install.installDir ?? input.defaultInstallDir };
}

/** The line printed for a refusal — one message per reason, no fallthrough. */
function refusalMessage(plan: Extract<UpdatePlan, { action: "refuse" }>, t: Messages): string {
  switch (plan.reason) {
    case "source":
      return t.update.sourceCheckout();
    case "unknown-install":
      return t.update.unknownInstall(plan.modulePath);
    case "unknown-manager":
      return t.update.npmUnknownManager(plan.globalRoot, plan.target);
    case "windows-global":
      return t.update.windowsGlobalInstall(plan.command);
    case "windows-installer":
      return t.update.windowsUnsupported();
  }
}

export function registerUpdateCommand(program: Command, t: Messages): void {
  program
    .command("update")
    .description(t.update.desc)
    .option("--check", t.update.check)
    .option("--release <tag>", t.update.releaseOpt)
    .option("-y, --yes", t.update.yes)
    .action(async (opts: { check?: boolean; release?: string; yes?: boolean }) => {
      const current = VERSION;
      const target = opts.release ? normalizeVersion(opts.release) : await fetchLatestVersion(t);
      const modulePath = selfPath();
      const defaultInstallDir = path.join(homedir(), ".penguin");
      const plan = planUpdate({
        current,
        target,
        ...(opts.check !== undefined ? { check: opts.check } : {}),
        install: detectInstall(modulePath),
        modulePath,
        platform: process.platform,
        defaultInstallDir,
      });

      if (plan.action === "report") {
        process.stdout.write(`${t.update.checkReport(plan.current, plan.target)}\n`);
        process.stdout.write(
          `${plan.comparison > 0 ? t.update.upgradeAvailable(plan.target) : plan.comparison < 0 ? t.update.targetIsOlder(plan.target) : t.update.upToDate(plan.current)}\n`,
        );
        return;
      }
      if (plan.action === "up-to-date") {
        process.stdout.write(`${t.update.upToDate(plan.current)}\n`);
        return;
      }
      if (plan.action === "refuse") {
        process.stdout.write(`${refusalMessage(plan, t)}\n`);
        return;
      }

      // --- npm global install ---
      if (plan.action === "npm") {
        process.stdout.write(
          `${t.update.planNpm(current, target, plan.manager, `${plan.command} ${plan.args.join(" ")}`)}\n`,
        );
        if (!(await confirmUpgrade(opts.yes, t))) return;
        const code = await run(plan.command, plan.args, {});
        process.stdout.write(`${code === 0 ? t.update.done(target) : t.update.failed()}\n`);
        if (code !== 0) process.exitCode = 1;
        return;
      }

      // --- tarball install: re-run the installer, preserving this install's shape ---
      const installDir = plan.installDir;
      const hasBundledNode = existsSync(path.join(installDir, "node"));
      process.stdout.write(
        `${t.update.planTarball(current, target, installDir, !hasBundledNode)}\n`,
      );
      if (!(await confirmUpgrade(opts.yes, t))) return;

      const url = installerUrl(opts.release ? target : undefined);
      let script: string;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(String(res.status));
        script = await res.text();
      } catch {
        process.stdout.write(`${t.update.installerFetchFailed(url)}\n`);
        process.exitCode = 1;
        return;
      }

      // A private 0700 directory with an unpredictable name, never a fixed path in the shared
      // world-writable temp dir: nobody else can pre-create this path as a symlink to overwrite,
      // or swap the file out between the write below and the spawn. `wx` refuses to truncate an
      // existing entry rather than inheriting its mode and owner. It is outside installDir on
      // purpose — the installer replaces that tree, and a shell script deleted mid-execution is
      // not something to rely on.
      const scriptDir = mkdtempSync(path.join(tmpdir(), "penguin-update-"));
      const scriptPath = path.join(scriptDir, "install.sh");
      writeFileSync(scriptPath, script, { mode: 0o700, flag: "wx" });

      const { args, env } = buildInstallerInvocation({
        scriptPath,
        installDir,
        hasBundledNode,
        defaultInstallDir,
        version: opts.release ? target : undefined,
      });
      // Past this point the installer may delete the tree this process runs from. Everything below
      // is already-loaded code and already-resolved strings: no import, no file read, no re-entry.
      const code = await run("sh", args, env);
      // Safe only here: `close` has fired, so the child `sh` has exited and nothing is still
      // reading the script (install.sh runs to completion synchronously and backgrounds nothing —
      // it does its own `trap 'rm -rf "$TMP"' EXIT` cleanup and then returns). Deleting it any
      // earlier would pull the script out from under a running interpreter. `force` keeps a
      // failed cleanup from turning a successful upgrade into an error.
      rmSync(scriptDir, { recursive: true, force: true });
      process.stdout.write(`${code === 0 ? t.update.done(target) : t.update.failed()}\n`);
      if (code !== 0) process.exitCode = 1;
    });
}

/**
 * How the confirmation gate resolves, decided before any I/O: `--yes` proceeds outright, a
 * non-interactive stdio pair has to be *told* rather than asked — a prompt nobody can answer would
 * hang the upgrade forever in a pipe or a CI job — and anything else gets the interactive prompt.
 *
 * Pure, so the "must pass --yes" path is testable without a pseudo-terminal.
 */
export function confirmationMode(
  yes: boolean | undefined,
  interactive: boolean,
): "proceed" | "needs-yes" | "prompt" {
  if (yes) return "proceed";
  return interactive ? "prompt" : "needs-yes";
}

/** Confirmation gate: `--yes` skips it; a non-TTY stdin must pass `--yes` rather than hang. */
async function confirmUpgrade(yes: boolean | undefined, t: Messages): Promise<boolean> {
  const mode = confirmationMode(yes, Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (mode === "proceed") return true;
  if (mode === "needs-yes") {
    process.stdout.write(`${t.update.needsYes()}\n`);
    return false;
  }
  if (await confirmYes(t.update.confirm())) return true;
  process.stdout.write(`${t.update.cancelled()}\n`);
  return false;
}
