/**
 * Shell selection for command sessions.
 *
 * POSIX behavior is unchanged: commands run via `bash -lc <cmd>`. On Windows there is no
 * bash by default, so the resolver picks the best available shell once per process:
 *
 * 1. `PENGUIN_SHELL` (explicit executable name or path) always wins, on every platform;
 *    the argument shape is inferred from its basename (see below).
 * 2. Otherwise, non-Windows uses `bash -lc` (today's behavior, bit for bit).
 * 3. On Windows, probe PATH for `bash` (Git for Windows — best compatibility with the
 *    skill/prompt ecosystem, which is written for a POSIX shell), then `pwsh`
 *    (PowerShell 7+), then fall back to `powershell` (Windows PowerShell 5.1, always
 *    present). A `bash` that resolves into the Windows system directory is ignored: that
 *    is the WSL launcher, which runs commands inside a Linux distro with a different
 *    filesystem view (and fails outright when no distro is configured).
 *
 * Argument shapes by basename (also applied to `PENGUIN_SHELL` values):
 * - `pwsh` / `powershell` -> `-NoLogo -NoProfile -Command <cmd>`
 * - `cmd`                 -> `/d /s /c <cmd>`
 * - anything else         -> `-lc <cmd>` (bash/zsh/sh-style login shell)
 *
 * The resolved shell's name is surfaced to the model via the session environment (the
 * `Shell:` line in the system prompt), so it knows which syntax the exec tool speaks.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

/** A resolved shell invocation: `spawn(command, [...args, cmd])` runs `cmd` in that shell. */
export interface ShellInvocation {
  /** Executable name or absolute path handed to spawn(). */
  command: string;
  /** Fixed argument prefix placed before the command string. */
  args: string[];
  /** Short lowercase name (basename without extension), shown to the model (e.g. "bash", "pwsh"). */
  name: string;
}

/** Injection points for unit tests; production callers use the defaults. */
export interface ResolveShellOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Returns the PATH resolutions of an executable name, best match first ([] when not found). */
  whichAll?: (cmd: string) => string[];
  /** The Windows system root (to recognize the WSL bash launcher); default `env.SystemRoot` or C:\Windows. */
  systemRoot?: string;
}

/** Basename without a trailing .exe/.cmd/.bat/.ps1 extension, lowercased ("C:\...\pwsh.EXE" -> "pwsh"). */
function shellBasename(command: string): string {
  // path.win32 handles both separators, so PENGUIN_SHELL=/usr/bin/zsh still yields "zsh".
  return path.win32
    .basename(command)
    .replace(/\.(exe|cmd|bat|ps1)$/i, "")
    .toLowerCase();
}

/** Argument prefix for a shell, chosen by its basename (PowerShell-style vs cmd vs POSIX-style). */
function argsForShell(name: string): string[] {
  if (name === "pwsh" || name === "powershell") return ["-NoLogo", "-NoProfile", "-Command"];
  if (name === "cmd") return ["/d", "/s", "/c"];
  return ["-lc"];
}

/** Default PATH probe: `where` lists every match line by line, in PATH order (win32 only). */
function defaultWhichAll(cmd: string): string[] {
  try {
    const res = spawnSync("where", [cmd], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return [];
    return res.stdout
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Resolves the shell for command sessions (pure given its options; see the module comment
 * for the order). Exported for unit tests; runtime code uses the cached `sessionShell()`.
 */
export function resolveShell(opts: ResolveShellOptions = {}): ShellInvocation {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  const explicit = env.PENGUIN_SHELL?.trim();
  if (explicit) {
    const name = shellBasename(explicit);
    return { command: explicit, args: argsForShell(name), name };
  }

  if (platform !== "win32") {
    return { command: "bash", args: ["-lc"], name: "bash" };
  }

  const whichAll = opts.whichAll ?? defaultWhichAll;
  const systemRoot = opts.systemRoot ?? env.SystemRoot ?? "C:\\Windows";
  // The WSL launcher lives in <SystemRoot>\System32 (or Sysnative under WOW64); a Git for
  // Windows bash lives under the Git install dir. Only the first PATH match counts — that
  // is the one spawn("bash") would run.
  const bash = whichAll("bash")[0];
  if (bash && !bash.toLowerCase().startsWith(systemRoot.toLowerCase() + path.win32.sep)) {
    return { command: "bash", args: ["-lc"], name: "bash" };
  }
  if (whichAll("pwsh").length > 0) {
    return { command: "pwsh", args: argsForShell("pwsh"), name: "pwsh" };
  }
  return { command: "powershell", args: argsForShell("powershell"), name: "powershell" };
}

let cached: ShellInvocation | null = null;

/** The process-wide shell for command sessions; resolved once (probing PATH costs a subprocess on Windows). */
export function sessionShell(): ShellInvocation {
  if (!cached) cached = resolveShell();
  return cached;
}
