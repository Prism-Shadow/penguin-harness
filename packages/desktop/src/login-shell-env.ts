/**
 * Login-shell environment import for GUI launches (#351).
 *
 * A shell launched from the macOS Dock or a Linux desktop session inherits the session
 * manager's environment, not the user's login shell — exports from `.zshrc` / `.profile`
 * (model API keys picked up by core's env fallback, the PATH the agent shell needs for
 * user-installed tooling) never reach it. Without this import, the desktop app makes the
 * user re-enter keys that already work in their terminal, and agent commands run on the
 * bare system PATH.
 *
 * On macOS and Linux, when no terminal launched us (no TERM), the user's shell is run
 * once as an interactive login shell (`-i -l -c`, so both profile and rc files are read)
 * around a sentinel-framed `env -0` dump. NUL separation keeps values containing
 * newlines intact, and the sentinel frame cuts away whatever the rc files print around
 * it. The result is merged fill-missing-only into `process.env` before anything reads it:
 * an explicitly provided variable always wins, so a launch from a terminal — where the
 * import is skipped anyway — and a launch with variables set on the command line behave
 * exactly as before. The embedded server (and with it the agent shell) inherits
 * `process.env` at fork time, so the import reaches both without further plumbing.
 *
 * Everything but the probe spawn is pure and unit-tests without Electron; the probe is
 * best-effort with a hard timeout — any failure leaves the environment untouched.
 * `PENGUIN_NO_LOGIN_SHELL_ENV` (any non-empty value) skips the probe, the escape hatch
 * for a login shell that cannot run non-interactively within the timeout.
 */
import { spawn } from "node:child_process";

/** Frame marker around the probe's `env -0` output; rc-file noise falls outside the frame. */
const SENTINEL = "__PENGUIN_LOGIN_SHELL_ENV__";

/** The probe: static string, no interpolation, so no quoting hazards in any POSIX-ish shell. */
const PROBE_COMMAND = `printf '%s' '${SENTINEL}'; env -0; printf '%s' '${SENTINEL}'`;

/** Hard cap on the probe's lifetime; a hung interactive rc file must not stall app startup. */
export const PROBE_TIMEOUT_MS = 5_000;

/** Cap on collected probe output; an env dump is kilobytes, anything larger is runaway noise. */
const PROBE_OUTPUT_CAP = 4 * 1024 * 1024;

/**
 * Keys never imported: shell-position bookkeeping the probe shell wrote for itself
 * (`_`, `SHLVL`, `PWD`, `OLDPWD`), the probe's own terminal identity (`TERM`), and
 * `ELECTRON_RUN_AS_NODE` — importing that one would make every later relaunch of the
 * app run as plain Node instead of Electron.
 */
const EXCLUDED_KEYS = new Set(["_", "SHLVL", "PWD", "OLDPWD", "TERM", "ELECTRON_RUN_AS_NODE"]);

/** Environment variable names as the POSIX shells define them; also drops `BASH_FUNC_f%%` exported functions. */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Whether this launch should import the login shell environment: never on Windows (GUI
 * processes inherit the user environment there), never when a terminal launched us
 * (TERM set — the environment is already the shell's), and never when the escape hatch
 * `PENGUIN_NO_LOGIN_SHELL_ENV` is set.
 */
export function shouldImportLoginShellEnv(opts: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}): boolean {
  if (opts.platform === "win32") return false;
  if (opts.env.TERM !== undefined) return false;
  if (opts.env.PENGUIN_NO_LOGIN_SHELL_ENV) return false;
  return true;
}

/** The shell to probe: the user's `$SHELL` when absolute, else the platform default. */
export function probeShell(shell: string | undefined, platform: NodeJS.Platform): string {
  if (shell !== undefined && shell.startsWith("/")) return shell;
  return platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

/**
 * Extracts the environment record from the probe's stdout: the NUL-separated
 * `KEY=VALUE` entries between the first sentinel and the next one after it (a zsh
 * `zlogout` may print after the closing frame, so the close is the *next* occurrence,
 * not the last). Returns null when the frame is missing or holds no valid entry —
 * including when `env` does not support `-0` and printed nothing between the frames.
 */
export function parseLoginShellEnvDump(stdout: string): Record<string, string> | null {
  const open = stdout.indexOf(SENTINEL);
  if (open === -1) return null;
  const close = stdout.indexOf(SENTINEL, open + SENTINEL.length);
  if (close === -1) return null;
  const dump = stdout.slice(open + SENTINEL.length, close);
  const out: Record<string, string> = {};
  for (const entry of dump.split("\0")) {
    if (entry.length === 0) continue;
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (!KEY_PATTERN.test(key)) continue;
    out[key] = entry.slice(eq + 1);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The patch to apply to `current`: every imported variable `current` leaves unset,
 * minus `EXCLUDED_KEYS`. PATH is the one merged key — a GUI launch *has* a PATH (the
 * bare system one), so fill-missing alone would never improve it: the login shell's
 * entries come first (its ordering wins), current-only entries are appended, duplicates
 * and empties dropped.
 */
export function mergeLoginShellEnv(
  current: NodeJS.ProcessEnv,
  imported: Record<string, string>,
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(imported)) {
    if (key === "PATH" || EXCLUDED_KEYS.has(key)) continue;
    if (current[key] !== undefined) continue;
    patch[key] = value;
  }
  const importedPath = imported["PATH"];
  if (importedPath !== undefined) {
    const currentPath = current["PATH"];
    const merged =
      currentPath === undefined ? importedPath : mergePathValue(importedPath, currentPath);
    if (merged !== currentPath) patch["PATH"] = merged;
  }
  return patch;
}

/** Login-shell PATH entries first, then current-only ones; deduplicated, empties dropped. */
function mergePathValue(importedPath: string, currentPath: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...importedPath.split(":"), ...currentPath.split(":")]) {
    if (entry.length === 0 || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.join(":");
}

/**
 * Runs the probe and returns the parsed environment, or null on any failure (spawn
 * error, timeout, output cap, unparseable output). The exit code is deliberately
 * ignored: login rc files exit non-zero for reasons of their own, and the
 * sentinel-framed dump is the actual signal.
 */
export function resolveLoginShellEnv(opts: {
  shell: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(opts.shell, ["-i", "-l", "-c", PROBE_COMMAND], {
        env: opts.env,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let settled = false;
    // Settle exactly once. On timeout or cap overrun the promise resolves immediately
    // after the kill instead of waiting for "close": a hung rc file's own children
    // inherit the stdout pipe and would hold "close" open for as long as they live.
    const settle = (value: Record<string, string> | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(null);
    }, opts.timeoutMs ?? PROBE_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
      if (stdout.length > PROBE_OUTPUT_CAP) {
        child.kill("SIGKILL");
        settle(null);
      }
    });
    child.on("error", () => settle(null));
    child.on("close", () => settle(parseLoginShellEnvDump(stdout)));
  });
}

/**
 * Entry point for the shell's boot path: probes when `shouldImportLoginShellEnv` says
 * to, merges fill-missing into `opts.env` (normally `process.env`), and returns the
 * number of variables applied. Best-effort: every failure path logs one line and
 * returns 0 with the environment untouched.
 */
export async function applyLoginShellEnv(opts: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  shell: string | undefined;
  timeoutMs?: number;
  log: (line: string) => void;
}): Promise<number> {
  if (!shouldImportLoginShellEnv(opts)) return 0;
  const shell = probeShell(opts.shell, opts.platform);
  const resolved = await resolveLoginShellEnv({
    shell,
    env: opts.env,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  if (resolved === null) {
    opts.log(`login shell environment unavailable (${shell}); continuing without it`);
    return 0;
  }
  const patch = mergeLoginShellEnv(opts.env, resolved);
  Object.assign(opts.env, patch);
  const count = Object.keys(patch).length;
  if (count > 0) {
    opts.log(`imported ${count} environment variable(s) from the login shell (${shell})`);
  }
  return count;
}
