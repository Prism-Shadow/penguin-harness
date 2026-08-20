/**
 * Which shell a terminal session runs, and how it is invoked.
 *
 * This is deliberately NOT core's `resolveShell()` (environment/tools/command/shell.ts).
 * That one picks a shell for the *agent* to run commands in: it prefers a POSIX bash on
 * Windows because Skills are written for one, and it passes `-NoProfile` to PowerShell so
 * two machines behave identically. Both choices are wrong for a human at a keyboard, who
 * expects the shell their OS gives them, with their own profile in effect — the prompt,
 * the aliases, the PATH edits. So the two resolvers stay separate on purpose.
 *
 * `PENGUIN_SHELL` is honoured first on every platform, so a user who has already told the
 * harness which shell to use is not asked twice.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

/** Injection points for unit tests; production callers use the defaults. */
export interface ResolveTerminalShellOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Whether an executable name resolves on PATH (win32 only); default probes with `where`. */
  onPath?: (cmd: string) => boolean;
}

/** Basename without a trailing .exe/.cmd/.bat, lowercased ("C:\...\pwsh.EXE" -> "pwsh"). */
function shellName(shell: string): string {
  // path.win32 handles both separators, so /usr/bin/zsh still yields "zsh".
  return path.win32
    .basename(shell)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
}

/** Default PATH probe (win32 only, one subprocess per name, cached by the caller). */
function defaultOnPath(cmd: string): boolean {
  try {
    const res = spawnSync("where", [cmd], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return res.status === 0 && (res.stdout?.toString("utf8").trim().length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * The shell to spawn when the request names none.
 *
 * POSIX takes `$SHELL` — the user's own login shell, exactly what a terminal emulator
 * opens. Windows has no such variable, and `%ComSpec%` (cmd.exe) reads no profile at all,
 * so PowerShell comes first: pwsh when installed, else the Windows PowerShell that every
 * machine has. cmd.exe remains the last resort rather than the default.
 */
export function resolveDefaultShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  opts: ResolveTerminalShellOptions = {},
): string {
  const explicit = env.PENGUIN_SHELL?.trim();
  if (explicit) return explicit;
  if (platform !== "win32") return env.SHELL || "/bin/sh";

  const onPath = opts.onPath ?? defaultOnPath;
  if (onPath("pwsh")) return "pwsh.exe";
  if (onPath("powershell")) return "powershell.exe";
  return env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
}

/**
 * Arguments that make the shell interactive *with the user's profile loaded* — the whole
 * point of a terminal, and the one thing every shell spells differently.
 *
 * - POSIX shells: `-l`. A login shell reads the profile chain (`~/.zprofile`,
 *   `~/.bash_profile`/`~/.profile`), and an interactive one reads its rc file on top,
 *   which is what a pty already makes it. It is also what MinGit's bash needs on Windows
 *   to pick up `etc/profile` and its PATH.
 * - PowerShell: nothing but `-NoLogo`. Profiles load by default; passing `-l` would be an
 *   error on Windows, and `-NoProfile` would defeat the purpose.
 * - cmd.exe: has neither concept.
 */
export function shellArgs(shell: string): string[] {
  const name = shellName(shell);
  if (name === "pwsh" || name === "powershell") return ["-NoLogo"];
  if (name === "cmd") return [];
  return ["-l"];
}

let cachedDefault: string | null = null;

/**
 * The process-wide default shell. Cached because the Windows probe costs a subprocess and
 * the answer cannot change while the server runs.
 */
export function defaultTerminalShell(): string {
  if (cachedDefault === null) cachedDefault = resolveDefaultShell();
  return cachedDefault;
}
