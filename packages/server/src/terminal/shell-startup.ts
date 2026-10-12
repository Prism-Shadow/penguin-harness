/**
 * The harness's own `penguin` first on a terminal's PATH, once the user's startup files
 * have run.
 *
 * The commands an Agent runs already find the server's CLI shim directory (`<root>/bin`) at
 * the front of PATH (SessionEnv.pathPrepend, core's path-prepend.ts). A terminal is a login
 * shell a person types into, and the same `penguin` should answer there. That matters most
 * on a development checkout, where whatever `penguin` the machine has installed is some
 * other version. The pty's environment alone does not decide it: the shell's startup files
 * run afterwards and routinely rewrite PATH. Debian's /etc/profile replaces it, macOS's
 * path_helper reorders it, and a user's rc prepends ~/.local/bin or a version manager. So
 * each shell is started the way it can be told to run one more statement AFTER its own
 * startup files, and that statement puts the directory first:
 *
 * - bash: `--rcfile <file> -i`. The file runs what a login shell would have read
 *   (/etc/profile, then the first of ~/.bash_profile, ~/.bash_login and ~/.profile), then
 *   prepends. The shell is interactive but no longer a login shell, so `logout` asks for
 *   `exit` and ~/.bash_logout is not read. On Debian-family systems /etc/bash.bashrc runs
 *   twice: bash reads it for every interactive non-login shell, and /etc/profile sources it.
 * - zsh: `ZDOTDIR` names a directory of the four files a login shell reads. Each one sources
 *   the user's own file of the same name, with ZDOTDIR set back to the user's while it runs.
 *   The last one restores the user's ZDOTDIR for good, so `exec zsh` reads the user's files
 *   directly, and then prepends.
 * - fish: `--init-command`, which fish runs after its configuration.
 * - PowerShell: `-NoExit -Command`, which runs after the profiles.
 * - cmd: `/K`, which runs after the AutoRun command.
 * - sh, dash, ash: `ENV`, which an interactive POSIX shell reads after its login profile.
 *   The file sources the user's own `ENV` first. A profile that sets ENV itself replaces
 *   the hook, and the environment half below is what is left.
 *
 * Every shell but cmd also gets the directory at the front of the pty's environment PATH.
 * That half still counts when no hook runs: an rc that `exec`s another shell, or a shell
 * this module does not know. The hooks leave PATH alone when the directory already leads.
 *
 * Nothing is echoed into the terminal: every hook is a startup file or a startup argument,
 * never typed input. The files sit at a stable place under the data root and depend only on
 * the directories. Each is rewritten only when its content changes, and replaced
 * atomically, so no terminal leaves one behind and a shell never reads half of one.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { shellArgs, shellName } from "./shell.js";

/** What a terminal puts first on PATH, and where the startup files that do it live. */
export interface TerminalPathFirst {
  /** The directories that must lead PATH once the shell is ready, in order: the CLI shim dir. */
  dirs: readonly string[];
  /** The directory holding the startup files, see {@link shellStartupDir}. */
  startupDir: string;
}

/** `<root>/shell-startup`, where the terminal startup files of a data root are kept. */
export function shellStartupDir(root: string): string {
  return path.join(root, "shell-startup");
}

/** How to spawn the shell: node-pty's argument form (an argv, or cmd's command line) and the environment. */
export interface ShellLaunch {
  args: string[] | string;
  env: Record<string, string>;
}

/** POSIX shells that read `ENV` after the login profile and have no default file of their own. */
const ENV_HOOK_SHELLS = new Set(["sh", "dash", "ash"]);

const HEADER = [
  "# PenguinHarness terminal startup, written by the server (packages/server/src/terminal/shell-startup.ts).",
  "# Runs the startup files the shell would have read, then puts this harness's penguin first on PATH.",
];

/**
 * The launch of `shell` with `pathFirst` applied. Null, or no directories, is the plain
 * launch: the shell's usual arguments, `env` untouched. Never throws: when the startup
 * files cannot be written, the terminal still opens with the environment half only.
 */
export function shellLaunch(
  shell: string,
  env: Record<string, string>,
  pathFirst: TerminalPathFirst | null,
  platform: NodeJS.Platform = process.platform,
): ShellLaunch {
  const args = shellArgs(shell);
  if (pathFirst === null || pathFirst.dirs.length === 0) return { args, env };
  const { dirs, startupDir } = pathFirst;
  const name = shellName(shell);
  const envFirst = withPathFirst(env, dirs, platform);
  try {
    if (name === "bash") {
      const file = path.join(startupDir, "bashrc");
      writeStartupFile(file, bashrc(dirs, platform));
      // Long options go before the single-letter ones, or bash rejects them.
      return { args: ["--rcfile", file, "-i"], env: envFirst };
    }
    if (name === "zsh") {
      const dir = path.join(startupDir, "zsh");
      for (const [file, content] of zshFiles(dirs, platform)) {
        writeStartupFile(path.join(dir, file), content);
      }
      const next: Record<string, string> = { ...envFirst, ZDOTDIR: dir };
      delete next.PENGUIN_USER_ZDOTDIR;
      // A ZDOTDIR naming this very directory is a leftover of an interrupted startup, not
      // the user's: reading it back would make the hook source itself.
      const user = env.ZDOTDIR;
      if (user !== undefined && user !== "" && user !== dir) next.PENGUIN_USER_ZDOTDIR = user;
      return { args, env: next };
    }
    if (name === "fish") {
      return { args: [...args, "--init-command", fishPathFirst(dirs, platform)], env: envFirst };
    }
    if (name === "pwsh" || name === "powershell") {
      return { args: [...args, "-NoExit", "-Command", powerShellPathFirst(dirs)], env: envFirst };
    }
    if (name === "cmd") {
      // A pre-built command line: cmd parses its own, and an argv would be re-quoted by
      // rules it does not follow. The environment is left as it was, or the statement
      // would put a second copy in front of the first.
      return { args: `/K set "PATH=${dirs.join(";")};%PATH%"`, env };
    }
    if (ENV_HOOK_SHELLS.has(name)) {
      const file = path.join(startupDir, "env.sh");
      writeStartupFile(file, envSh(dirs, platform));
      const next: Record<string, string> = { ...envFirst, ENV: file };
      delete next.PENGUIN_USER_ENV;
      const user = env.ENV;
      if (user !== undefined && user !== "" && user !== file) next.PENGUIN_USER_ENV = user;
      return { args, env: next };
    }
  } catch {
    // A data root that cannot hold the files: fall through to the environment half.
  }
  return { args, env: envFirst };
}

/**
 * `env` with `dirs` at the front of PATH. On Windows the existing entry's own spelling is
 * reused (`Path` is common there), since a second entry differing only in case leaves the
 * child to pick one.
 */
function withPathFirst(
  env: Record<string, string>,
  dirs: readonly string[],
  platform: NodeJS.Platform,
): Record<string, string> {
  const delimiter = platform === "win32" ? ";" : ":";
  const key =
    platform === "win32"
      ? (Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH")
      : "PATH";
  const current = env[key];
  const lead = dirs.join(delimiter);
  return { ...env, [key]: current ? `${lead}${delimiter}${current}` : lead };
}

/** A string as one POSIX shell word: single-quoted, with each embedded quote spliced as `'\''`. */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A directory as a POSIX shell on this platform spells it. On Windows that shell is MSYS
 * (Git Bash), whose PATH is colon-separated `/c/...`: a `C:\...` entry would be split at
 * its drive colon.
 */
function posixDir(dir: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return dir;
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(dir);
  if (drive === null) return dir.replaceAll("\\", "/");
  return `/${drive[1]!.toLowerCase()}/${drive[2]!.replaceAll("\\", "/")}`;
}

/** The POSIX statement that moves `dirs` to the front of PATH unless they already lead it. */
function posixPathFirst(dirs: readonly string[], platform: NodeJS.Platform): string[] {
  const lead = dirs.map((dir) => posixQuote(posixDir(dir, platform))).join(":");
  return [
    "case ${PATH-} in",
    `  ${lead} | ${lead}:*) ;;`,
    `  *) PATH=${lead}\${PATH:+:\$PATH}; export PATH ;;`,
    "esac",
  ];
}

function bashrc(dirs: readonly string[], platform: NodeJS.Platform): string {
  return [
    ...HEADER,
    "# bash reads this file in place of its own (--rcfile), so it runs the files a login shell reads.",
    "if [ -r /etc/profile ]; then . /etc/profile; fi",
    'if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"',
    'elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"',
    'elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"',
    "fi",
    ...posixPathFirst(dirs, platform),
    "",
  ].join("\n");
}

/**
 * The four files of the zsh hook. zsh reads them in this order for a login shell; each
 * runs the user's file of the same name from the user's ZDOTDIR (HOME when unset), with
 * ZDOTDIR set to it, at the top level (a function would turn the user's `typeset`s local).
 * The user's ZDOTDIR is re-read after each file, which may have moved it. The system files
 * zsh reads in between see this directory as ZDOTDIR: macOS's /etc/zshrc points HISTFILE
 * here (corrected below), and a system zshrc that runs compinit (Ubuntu's) keeps its dump
 * file here.
 */
function zshFiles(dirs: readonly string[], platform: NodeJS.Platform): Array<[string, string]> {
  const user = (file: string): string[] => [
    "if [[ -n $_penguin_uzd ]]; then ZDOTDIR=$_penguin_uzd; else unset ZDOTDIR; fi",
    `[[ -r "\${ZDOTDIR:-$HOME}/${file}" ]] && builtin source "\${ZDOTDIR:-$HOME}/${file}"`,
    "_penguin_uzd=${ZDOTDIR-}",
    "ZDOTDIR=$_penguin_zd",
  ];
  // The end of startup: ZDOTDIR is the user's again, for `exec zsh` and nested shells.
  const finish = [
    "if [[ -n $_penguin_uzd ]]; then export ZDOTDIR=$_penguin_uzd; else unset ZDOTDIR; fi",
    "unset _penguin_zd _penguin_uzd",
    ...posixPathFirst(dirs, platform),
  ];
  return [
    [
      ".zshenv",
      [
        ...HEADER,
        "_penguin_zd=$ZDOTDIR",
        "_penguin_uzd=${PENGUIN_USER_ZDOTDIR-}",
        "unset PENGUIN_USER_ZDOTDIR",
        ...user(".zshenv"),
        "",
      ].join("\n"),
    ],
    [".zprofile", [...HEADER, ...user(".zprofile"), ""].join("\n")],
    [
      ".zshrc",
      [
        ...HEADER,
        // macOS's /etc/zshrc, read just before this file, sets HISTFILE from ZDOTDIR, which
        // is this directory: history belongs in the user's.
        'if [[ -n ${HISTFILE-} && "${HISTFILE:h}" == "$_penguin_zd" ]]; then',
        "  HISTFILE=${_penguin_uzd:-$HOME}/${HISTFILE:t}",
        "fi",
        ...user(".zshrc"),
        // A shell that is not a login shell reads no .zlogin: finish here instead.
        "if [[ ! -o login ]]; then",
        ...finish.map((line) => `  ${line}`),
        "fi",
        "",
      ].join("\n"),
    ],
    [".zlogin", [...HEADER, ...user(".zlogin"), ...finish, ""].join("\n")],
  ];
}

function envSh(dirs: readonly string[], platform: NodeJS.Platform): string {
  return [
    ...HEADER,
    "# Read as $ENV, after the login profile: the user's own $ENV runs first.",
    'if [ -n "${PENGUIN_USER_ENV-}" ]; then',
    "  ENV=$PENGUIN_USER_ENV",
    "  unset PENGUIN_USER_ENV",
    '  if [ -r "$ENV" ]; then . "$ENV"; fi',
    "else",
    "  unset ENV",
    "fi",
    ...posixPathFirst(dirs, platform),
    "",
  ].join("\n");
}

/** A string as a fish single-quoted literal, where only `\` and `'` are escaped. */
function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function fishPathFirst(dirs: readonly string[], platform: NodeJS.Platform): string {
  const quoted = dirs.map((dir) => fishQuote(posixDir(dir, platform)));
  return `test "$PATH[1]" = ${quoted[0]}; or set -gx PATH ${quoted.join(" ")} $PATH`;
}

/** A string as a PowerShell single-quoted literal, where a quote is escaped by doubling it. */
function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function powerShellPathFirst(dirs: readonly string[]): string {
  const lead = dirs.map(powerShellQuote).join(" + $s + ");
  // A script block keeps $s out of the user's session; $env: is process-wide.
  return (
    "& { $s = [string][IO.Path]::PathSeparator; " +
    `if (([string]$env:PATH).Split($s)[0] -ne ${powerShellQuote(dirs[0]!)}) ` +
    `{ $env:PATH = ${lead} + $s + $env:PATH } }`
  );
}

/**
 * Writes `content` to `file` unless it already holds exactly that. The new content goes to
 * a sibling first and is renamed over the file, so a shell starting at that moment reads
 * the old file or the new one, never part of one.
 */
function writeStartupFile(file: string, content: string): void {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
    // Missing or unreadable: write it.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staging = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(staging, content);
    fs.renameSync(staging, file);
  } catch (err) {
    fs.rmSync(staging, { force: true });
    throw err;
  }
}
