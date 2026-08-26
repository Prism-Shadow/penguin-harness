/**
 * Shell selection for command sessions.
 *
 * POSIX behavior is unchanged: commands run via `bash -lc <cmd>`. On Windows there is no
 * bash by default, so the resolver picks the best available shell once per process:
 *
 * 1. `PENGUIN_SHELL` (explicit executable name or path) always wins, on every platform;
 *    the argument shape is inferred from its basename (see below).
 * 2. Otherwise, non-Windows uses `bash -lc` — but only after confirming a `bash` exists.
 *    A GUI-launched app inherits the desktop session's PATH, not a login shell's, and a
 *    trimmed session PATH (or a distribution that simply does not install bash) leaves
 *    `spawn("bash")` dying with ENOENT before the command runs at all. So: `bash` on
 *    PATH, then the usual absolute locations, then `$SHELL` when it is some other POSIX
 *    shell, then `sh`. The probe is a PATH walk, not a subprocess.
 * 3. On Windows, probe PATH for `bash` (a full Git for Windows install — best compatibility
 *    with the skill/prompt ecosystem, which is written for a POSIX shell). A `bash` that
 *    resolves into the Windows system directory is ignored: that is the WSL launcher, which
 *    runs commands inside a Linux distro with a different filesystem view (and fails outright
 *    when no distro is configured).
 * 4. Then `PENGUIN_BUNDLED_SHELL` — the MinGit bash the Windows package ships (see the
 *    release workflow), advertised by the launcher shims as an absolute path. It comes
 *    *after* the PATH probe on purpose: a user's own Git for Windows carries the full MSYS
 *    userland (curl, tar, less, perl …), while MinGit carries ~60 core tools, so when both
 *    exist theirs is the better shell. This step is what makes the shell deterministic —
 *    without it, the same Agent and the same Skill behave differently on two Windows
 *    machines depending on what happens to be installed.
 * 5. Only then `pwsh` (PowerShell 7+), and finally `powershell` (Windows PowerShell 5.1,
 *    always present). These remain reachable for npm installs, which ship no bundle.
 *
 * Argument shapes by basename (also applied to `PENGUIN_SHELL` values):
 * - `pwsh` / `powershell` -> `-NoLogo -NoProfile -Command <cmd>`
 * - `cmd`                 -> `/d /s /c <cmd>`
 * - anything else         -> `-lc <cmd>` (bash/zsh/sh-style login shell)
 *
 * `-lc` matters for the bundled shell: as a login shell it sources MinGit's `etc/profile`,
 * which defaults to `MSYS2_PATH_TYPE=inherit` and yields
 * `/mingw64/bin:/usr/local/bin:/usr/bin:/bin:<inherited Windows PATH>` — the bundled coreutils
 * and git first, the inherited Windows PATH still behind them, so System32's `curl.exe` and
 * `tar.exe` (which MinGit does not carry) keep resolving. Nothing has to plumb PATH by hand.
 *
 * The resolved shell's name is surfaced to the model via the session environment (the
 * `Shell:` line in the system prompt), so it knows which syntax the exec tool speaks.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  /** Existence probe for the bundled shell path (injected in tests); default `fs.existsSync`. */
  exists?: (filePath: string) => boolean;
}

/** Basename without a trailing .exe/.cmd/.bat/.ps1 extension, lowercased ("C:\...\pwsh.EXE" -> "pwsh"). */
function shellBasename(command: string): string {
  // path.win32 handles both separators, so PENGUIN_SHELL=/usr/bin/zsh still yields "zsh".
  return path.win32
    .basename(command)
    .replace(/\.(exe|cmd|bat|ps1)$/i, "")
    .toLowerCase();
}

/**
 * Absolute POSIX locations to try when no `bash` is on PATH. A GUI launch can inherit a
 * PATH that omits the directory bash actually lives in, while the binary is right there.
 */
const POSIX_BASH_PATHS = [
  "/bin/bash",
  "/usr/bin/bash",
  "/usr/local/bin/bash",
  "/opt/homebrew/bin/bash",
];

/** POSIX shells worth falling back to, in the order they are tried, once bash is ruled out. */
const POSIX_FALLBACK_SHELLS = ["sh", "/bin/sh", "/usr/bin/sh"];

/** Argument prefix for a shell, chosen by its basename (PowerShell-style vs cmd vs POSIX-style). */
function argsForShell(name: string): string[] {
  if (name === "pwsh" || name === "powershell") return ["-NoLogo", "-NoProfile", "-Command"];
  if (name === "cmd") return ["/d", "/s", "/c"];
  return ["-lc"];
}

/**
 * Is `name` reachable as a bare command on this PATH? A plain directory walk — the POSIX
 * branch resolves at every process start and must not pay for a subprocess to do it.
 */
function onPath(name: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): boolean {
  const raw = env.PATH ?? "";
  for (const dir of raw.split(path.posix.delimiter)) {
    if (dir === "") continue;
    if (exists(path.posix.join(dir, name))) return true;
  }
  return false;
}

/**
 * The POSIX shell, in preference order. `bash` stays first and stays a *bare* name when
 * PATH has it, so the overwhelmingly common case is byte-identical to what shipped
 * before: the Skill and prompt ecosystem is written for bash, and the child resolves the
 * name against its own PATH. Everything after it exists so a box without bash degrades to
 * a working shell instead of an ENOENT on every single command.
 */
function resolvePosixShell(
  env: NodeJS.ProcessEnv,
  exists: (filePath: string) => boolean,
): ShellInvocation {
  if (onPath("bash", env, exists)) return { command: "bash", args: ["-lc"], name: "bash" };
  for (const candidate of POSIX_BASH_PATHS) {
    if (exists(candidate)) return { command: candidate, args: ["-lc"], name: "bash" };
  }
  // The user's own login shell, when it is not bash (zsh, fish, ksh …). It is named
  // honestly to the model: `-lc` is what every one of them speaks, but the syntax the
  // model should write is that shell's, not bash's.
  const login = env.SHELL?.trim();
  if (login !== undefined && login !== "" && login.startsWith("/") && exists(login)) {
    const name = shellBasename(login);
    return { command: login, args: argsForShell(name), name };
  }
  for (const candidate of POSIX_FALLBACK_SHELLS) {
    if (candidate.startsWith("/") ? exists(candidate) : onPath(candidate, env, exists)) {
      return { command: candidate, args: ["-lc"], name: "sh" };
    }
  }
  // Nothing answered. Keep the historical invocation so the failure is the familiar one.
  return { command: "bash", args: ["-lc"], name: "bash" };
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

  const exists = opts.exists ?? existsSync;
  if (platform !== "win32") {
    return resolvePosixShell(env, exists);
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
  // The bundled MinGit bash (installed-package layout only; absent for npm installs). Reported
  // to the model as "bash" rather than its filename: MinGit installs GNU bash under the name
  // `sh`, and the Skill ecosystem targets bash, so "sh" would understate what it can run.
  const bundled = env.PENGUIN_BUNDLED_SHELL?.trim();
  if (bundled && exists(bundled)) {
    return { command: bundled, args: ["-lc"], name: "bash" };
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
