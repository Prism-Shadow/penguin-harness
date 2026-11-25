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
 * Startup files are not the last word on PATH, though: a prompt hook runs after all of them,
 * before every prompt. Version managers and environment tools install one, and a hook that
 * puts its own directory first takes `penguin` over from the first prompt on. So bash, zsh and
 * fish also run the statement as their LAST prompt hook — `PROMPT_COMMAND`, `precmd_functions`,
 * the `fish_prompt` event — and keep the directory first before each prompt. They stay last:
 * a hook registered after startup (a lazy plugin loader's) would otherwise run after this one
 * from then on, so before each prompt the hook moves itself back behind it. Someone who wants
 * another `penguin` there runs it by its full path, or defines an alias or a function named
 * `penguin`, which these shells look up before PATH.
 *
 * Every shell but cmd also gets the directory at the front of the pty's environment PATH.
 * That half still counts when no hook runs: an rc that `exec`s another shell, or a shell
 * this module does not know. The hooks leave PATH alone when the directory already leads.
 *
 * A development instance's terminal opens with a line saying which `penguin` runs there and
 * against which data root (terminal/cli-notice.ts). The user's own startup files decide part of
 * that: one that exports PENGUIN_API_URL, or a PENGUIN_HOME naming another root, points
 * `penguin` at another server. So where it can, the shell prints that line itself, at its first
 * prompt, once those files have run — the line as given, or the one saying where `penguin`
 * goes instead ({@link ShellNotice}). Nothing else is printed: every hook is a startup file or
 * a startup argument, never typed input. The files sit at a stable place under the data root
 * and depend only on the directories and that line. Each is rewritten only when its content
 * changes, and replaced atomically, so no terminal leaves one behind and a shell never reads
 * half of one.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { shellArgs, shellName } from "./shell.js";

/** What a terminal puts first on PATH, where the startup files that do it live, and its first line. */
export interface TerminalPathFirst {
  /** The directories that must lead PATH once the shell is ready, in order: the CLI shim dir. */
  dirs: readonly string[];
  /** The directory holding the startup files, see {@link shellStartupDir}. */
  startupDir: string;
  /** A development instance's first line, for the shell to print at its first prompt. Absent or null: none. */
  notice?: ShellNotice | null;
}

/**
 * The first line of a development instance's terminal, printed by the shell itself at its first
 * prompt, after its own startup files: `text` while `penguin` there still targets this instance,
 * else `elsewhere`'s two halves around `VAR=value` — when those files set PENGUIN_API_URL, which
 * names a server outright, or a PENGUIN_HOME that is not `root` (a trailing `/` aside), which the
 * shim then leaves to the CLI.
 */
export interface ShellNotice {
  text: string;
  /** This instance's data root. */
  root: string;
  elsewhere: readonly [before: string, after: string];
}

/** `<root>/shell-startup`, where the terminal startup files of a data root are kept. */
export function shellStartupDir(root: string): string {
  return path.join(root, "shell-startup");
}

/** How to spawn the shell: node-pty's argument form (an argv, or cmd's command line) and the environment. */
export interface ShellLaunch {
  args: string[] | string;
  env: Record<string, string>;
  /** Whether the shell prints `pathFirst.notice` itself; otherwise whoever wanted it shows it. */
  printsNotice: boolean;
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
 * files cannot be written, the terminal still opens with the environment half only. cmd and
 * shells this module does not know print no notice; `printsNotice` says which happened.
 */
export function shellLaunch(
  shell: string,
  env: Record<string, string>,
  pathFirst: TerminalPathFirst | null,
  platform: NodeJS.Platform = process.platform,
): ShellLaunch {
  const args = shellArgs(shell);
  if (pathFirst === null || pathFirst.dirs.length === 0) return { args, env, printsNotice: false };
  const { dirs, startupDir } = pathFirst;
  const notice = pathFirst.notice ?? null;
  const printsNotice = notice !== null;
  const name = shellName(shell);
  const envFirst = withPathFirst(env, dirs, platform);
  try {
    if (name === "bash") {
      const file = path.join(startupDir, "bashrc");
      writeStartupFile(file, bashrc(dirs, notice, platform));
      // Long options go before the single-letter ones, or bash rejects them.
      return { args: ["--rcfile", file, "-i"], env: envFirst, printsNotice };
    }
    if (name === "zsh") {
      const dir = path.join(startupDir, "zsh");
      for (const [file, content] of zshFiles(dirs, notice, platform)) {
        writeStartupFile(path.join(dir, file), content);
      }
      const next: Record<string, string> = { ...envFirst, ZDOTDIR: dir };
      delete next.PENGUIN_USER_ZDOTDIR;
      // A ZDOTDIR naming this very directory is a leftover of an interrupted startup, not
      // the user's: reading it back would make the hook source itself.
      const user = env.ZDOTDIR;
      if (user !== undefined && user !== "" && user !== dir) next.PENGUIN_USER_ZDOTDIR = user;
      return { args, env: next, printsNotice };
    }
    if (name === "fish") {
      const init = fishPathFirst(dirs, notice, platform);
      return { args: [...args, "--init-command", init], env: envFirst, printsNotice };
    }
    if (name === "pwsh" || name === "powershell") {
      const command = [powerShellPathFirst(dirs), ...(notice ? [powerShellNotice(notice)] : [])];
      return {
        args: [...args, "-NoExit", "-Command", command.join("; ")],
        env: envFirst,
        printsNotice,
      };
    }
    if (name === "cmd") {
      // A pre-built command line: cmd parses its own, and an argv would be re-quoted by
      // rules it does not follow. The environment is left as it was, or the statement
      // would put a second copy in front of the first.
      return { args: `/K set "PATH=${dirs.join(";")};%PATH%"`, env, printsNotice: false };
    }
    if (ENV_HOOK_SHELLS.has(name)) {
      const file = path.join(startupDir, "env.sh");
      writeStartupFile(file, envSh(dirs, notice, platform));
      const next: Record<string, string> = { ...envFirst, ENV: file };
      delete next.PENGUIN_USER_ENV;
      const user = env.ENV;
      if (user !== undefined && user !== "" && user !== file) next.PENGUIN_USER_ENV = user;
      return { args, env: next, printsNotice };
    }
  } catch {
    // A data root that cannot hold the files: fall through to the environment half.
  }
  return { args, env: envFirst, printsNotice: false };
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

/**
 * The function bash and zsh run when startup ends — `__penguin_path_first startup` — and then
 * before every prompt, see {@link bashPathFirstFunction} and {@link zshPathFirstFunction}.
 */
const PATH_FIRST_FN = "__penguin_path_first";

/** The function that prints a development instance's first line, see {@link posixNotice}. */
const NOTICE_FN = "__penguin_notice";

/**
 * The prompt hook of powerlevel10k, which moves itself last among the zsh prompt hooks before
 * every prompt and leaves PATH alone: ours stays just before it rather than trading places.
 */
const P10K_PRECMD = "_p9k_precmd";

/**
 * The last `PROMPT_COMMAND` entry of bash-preexec, which keeps it there before every prompt:
 * it marks where the prompt's commands end and the user's begin, so ours stays before it — after
 * it, bash-preexec's `preexec` hooks would take our commands for the user's.
 */
const BASH_PREEXEC_LAST = "__bp_interactive_mode";

/**
 * The body lines, shared by bash and zsh, that move `words` (quoted directories) to the front of
 * PATH: other occurrences are dropped, so running them before every prompt never grows PATH, and
 * they change nothing while the directories already lead.
 */
function pathFirstLines(words: readonly string[]): string[] {
  const lead = words.join(":");
  return [
    '  local p=":${PATH-}:" d',
    "  case $p in",
    `    :${lead}:*) ;;`,
    "    *)",
    `      for d in ${words.join(" ")}; do`,
    '        while case $p in *":$d:"*) true ;; *) false ;; esac; do p=${p/":$d:"/:}; done',
    "      done",
    "      p=${p#:}; p=${p%:}",
    `      PATH=${lead}\${p:+:$p}; export PATH`,
    "      ;;",
    "  esac",
  ];
}

/**
 * bash's function: `dirs` first on PATH; then, before a prompt, {@link BASH_PROMPT_ENTRY} moved
 * back to the end of `PROMPT_COMMAND` if something was added after it (just before
 * bash-preexec's last entry, when that is there) — each copy dropped, so nothing grows — and,
 * at the first prompt, the notice.
 *
 * It runs before every prompt because startup files are not the last word on PATH: a prompt hook
 * — bash's `PROMPT_COMMAND`, zsh's `precmd_functions`, which version managers and environment
 * tools install — runs before each prompt, after every startup file, and one that puts its own
 * directory first would hand `penguin` to another installation from the first prompt on. Being
 * the last hook makes this one the last word instead, and staying last keeps it that way.
 *
 * It always succeeds, and leaves `$?` to the shell: bash and zsh both give the prompt the user's
 * last status back after their prompt hooks have run. A hook that returned that status instead
 * would itself fail after every failed command — which ends a shell running under `set -e` (a
 * `false && true` at the prompt is enough) and runs an ERR or ZERR trap a second time. Every
 * test it makes is an `if` or `case`, for the same reason.
 */
function bashPathFirstFunction(dirs: readonly string[], platform: NodeJS.Platform): string[] {
  const words = dirs.map((dir) => posixQuote(posixDir(dir, platform)));
  const last = BASH_PREEXEC_LAST;
  return [
    `${PATH_FIRST_FN}() {`,
    ...pathFirstLines(words),
    '  if [ "${1-}" = startup ]; then return 0; fi',
    `  local e=${posixQuote(BASH_PROMPT_ENTRY)} pc tail= x n`,
    '  if [ -n "${PROMPT_COMMAND+set}" ]; then',
    // An array runs whole only from bash 5.1; before that, or as one string, the entry is in
    // the first (only) element.
    "    if (( ${#PROMPT_COMMAND[@]} > 1 && (BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1)) )); then",
    '      local -a pcs=("${PROMPT_COMMAND[@]}") out=()',
    "      n=${#pcs[@]}",
    `      if [[ \${pcs[n-1]} != "$e" && ! ( \${pcs[n-1]} == ${last} && \${pcs[n-2]} == "$e" ) ]]; then`,
    '        for x in "${pcs[@]}"; do',
    `          x=\${x//$'\\n'"$e"/}`,
    '          if [[ -n $x && $x != "$e" ]]; then out+=("$x"); fi',
    "        done",
    "        n=${#out[@]}",
    `        if (( n > 0 )) && [[ \${out[n-1]} == ${last} ]]; then`,
    `          PROMPT_COMMAND=("\${out[@]:0:n-1}" "$e" ${last})`,
    "        else",
    '          PROMPT_COMMAND=("${out[@]}" "$e")',
    "        fi",
    "      fi",
    "    else",
    "      pc=$PROMPT_COMMAND",
    `      case $pc in *$'\\n'${last}) tail=$'\\n'${last}; pc=\${pc%"$tail"} ;; esac`,
    "      case $pc in",
    '        *"$e") ;;',
    "        *)",
    `          pc=\${pc//$'\\n'"$e"/}`,
    `          case $pc in "$e") pc= ;; "$e"$'\\n'*|"$e;"*) pc=\${pc#"$e"?} ;; esac`,
    `          PROMPT_COMMAND=\${pc:+$pc$'\\n'}$e$tail`,
    "          ;;",
    "      esac",
    "    fi",
    "  fi",
    `  if [ -n "\${__penguin_notice_pending-}" ]; then unset __penguin_notice_pending; ${NOTICE_FN}; fi`,
    "  return 0",
    "}",
    `${PATH_FIRST_FN} startup`,
  ];
}

/**
 * zsh's function, as bash's ({@link bashPathFirstFunction}) under zsh's own options, whatever
 * the user set: `dirs` first on PATH; then, before a prompt, itself moved back to the end of
 * `precmd_functions` if a hook was added after it — before powerlevel10k's, which keeps itself
 * last — and, at the first prompt, the notice. That one waits for a `sched +0`, which runs after
 * every prompt hook and after the instant prompt's own (powerlevel10k holds the terminal's output
 * until then, and would report a line printed earlier as console output during startup).
 */
function zshPathFirstFunction(dirs: readonly string[], platform: NodeJS.Platform): string[] {
  const words = dirs.map((dir) => posixQuote(posixDir(dir, platform)));
  const fn = PATH_FIRST_FN;
  return [
    `${fn}() {`,
    "  emulate -L zsh",
    ...pathFirstLines(words),
    "  if [[ ${1-} == startup ]]; then return 0; fi",
    "  case ${precmd_functions[-1]-}:${precmd_functions[-2]-} in",
    `    ${fn}:*|${P10K_PRECMD}:${fn}) ;;`,
    `    *) precmd_functions=(\${precmd_functions:#(${fn}|${P10K_PRECMD})} ${fn} \${(M)precmd_functions:#${P10K_PRECMD}}) ;;`,
    "  esac",
    "  if (( ${+__penguin_notice_pending} )); then",
    "    unset __penguin_notice_pending",
    `    if zmodload zsh/sched 2>/dev/null; then sched +0 ${NOTICE_FN}; else ${NOTICE_FN}; fi`,
    "  fi",
    "  return 0",
    "}",
    `${fn} startup`,
  ];
}

/**
 * What bash's `PROMPT_COMMAND` runs: the function, where it is defined. A string
 * `PROMPT_COMMAND` the user exports (`export PROMPT_COMMAND="history -a; …"` is a common line)
 * reaches every bash started from this one — a nested `bash`, tmux, `exec bash` — and those read
 * the user's files but not this one, so a bare call would print "command not found" at each of
 * their prompts. A failed check is a left-hand side of `&&`: no `set -e` exit, no ERR trap.
 */
const BASH_PROMPT_ENTRY = `declare -F ${PATH_FIRST_FN} >/dev/null && ${PATH_FIRST_FN}`;

/**
 * The notice function for bash, zsh and sh ({@link ShellNotice}): the line in yellow when the
 * shell's own variables point `penguin` elsewhere, dim otherwise, as the server draws a notice.
 * `printf` takes the variable's value as an argument, never as its format. On Windows, Git
 * Bash may spell the root either way.
 */
function posixNotice(notice: ShellNotice, platform: NodeJS.Platform): string[] {
  const roots = [...new Set([notice.root, posixDir(notice.root, platform)])].map(posixQuote);
  const [before, after] = notice.elsewhere.map(posixQuote);
  const elsewhere = (variable: string): string =>
    `    printf '\\033[33m%s%s%s\\033[0m\\n' ${before} "${variable}=$${variable}" ${after}`;
  const otherRoot = roots.map((root) => ` && [ "\${PENGUIN_HOME%/}" != ${root} ]`).join("");
  return [
    `${NOTICE_FN}() {`,
    '  [ -n "${ZSH_VERSION-}" ] && emulate -L zsh',
    '  if [ -n "${PENGUIN_API_URL-}" ]; then',
    elsewhere("PENGUIN_API_URL"),
    `  elif [ -n "\${PENGUIN_HOME-}" ]${otherRoot}; then`,
    elsewhere("PENGUIN_HOME"),
    "  else",
    `    printf '\\033[2m%s\\033[0m\\n' ${posixQuote(notice.text)}`,
    "  fi",
    "  return 0",
    "}",
  ];
}

/**
 * bash: {@link BASH_PROMPT_ENTRY} last in `PROMPT_COMMAND`, a string or (bash 5.1+) an array,
 * whichever the user's files left it as. Before 5.1 bash runs only an array's first element, so
 * there the entry joins that element, like the string form: newline-separated, which survives a
 * user value that ends in `;` or `&`.
 */
function bashPromptHook(): string[] {
  const entry = posixQuote(BASH_PROMPT_ENTRY);
  return [
    `if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]] &&`,
    "  (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then",
    `  [[ " \${PROMPT_COMMAND[*]} " == *" ${PATH_FIRST_FN} "* ]] || PROMPT_COMMAND+=(${entry})`,
    "else",
    "  case ${PROMPT_COMMAND-} in",
    `    *${PATH_FIRST_FN}*) ;;`,
    `    *) PROMPT_COMMAND=\${PROMPT_COMMAND:+$PROMPT_COMMAND$'\\n'}${entry} ;;`,
    "  esac",
    "fi",
  ];
}

/**
 * zsh: the function last in `precmd_functions`, after every hook the user's files added. The
 * array is tested for existence first: it runs at the user's options, and under `setopt nounset`
 * a subscript of an array nobody has set is an error printed above the first prompt.
 */
function zshPromptHook(): string[] {
  return [
    `(( \${+precmd_functions} )) && (( \${precmd_functions[(Ie)${PATH_FIRST_FN}]} )) ||`,
    `  precmd_functions+=(${PATH_FIRST_FN})`,
  ];
}

/**
 * The notice function, and the flag that has the prompt hook call it once, at the first prompt:
 * set after the startup call, which does not print.
 */
function noticeAtFirstPrompt(notice: ShellNotice | null, platform: NodeJS.Platform): string[] {
  return notice === null ? [] : [...posixNotice(notice, platform), "__penguin_notice_pending=1"];
}

function bashrc(
  dirs: readonly string[],
  notice: ShellNotice | null,
  platform: NodeJS.Platform,
): string {
  return [
    ...HEADER,
    "# bash reads this file in place of its own (--rcfile), so it runs the files a login shell reads.",
    "if [ -r /etc/profile ]; then . /etc/profile; fi",
    'if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"',
    'elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"',
    'elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"',
    "fi",
    ...bashPathFirstFunction(dirs, platform),
    ...noticeAtFirstPrompt(notice, platform),
    ...bashPromptHook(),
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
function zshFiles(
  dirs: readonly string[],
  notice: ShellNotice | null,
  platform: NodeJS.Platform,
): Array<[string, string]> {
  const user = (file: string): string[] => [
    "if [[ -n $_penguin_uzd ]]; then ZDOTDIR=$_penguin_uzd; else unset ZDOTDIR; fi",
    `[[ -r "\${ZDOTDIR:-$HOME}/${file}" ]] && builtin source "\${ZDOTDIR:-$HOME}/${file}"`,
    "_penguin_uzd=${ZDOTDIR-}",
    "ZDOTDIR=$_penguin_zd",
  ];
  // The end of startup: ZDOTDIR is the user's again, for `exec zsh` and nested shells; PATH
  // gets its directories first, now and before every prompt; the notice waits for the first.
  const finish = [
    "if [[ -n $_penguin_uzd ]]; then export ZDOTDIR=$_penguin_uzd; else unset ZDOTDIR; fi",
    "unset _penguin_zd _penguin_uzd",
    ...zshPathFirstFunction(dirs, platform),
    ...noticeAtFirstPrompt(notice, platform),
    ...zshPromptHook(),
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

/** sh's ENV file: the last of its startup, so the notice, if any, is printed at its end. */
function envSh(
  dirs: readonly string[],
  notice: ShellNotice | null,
  platform: NodeJS.Platform,
): string {
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
    ...(notice === null ? [] : [...posixNotice(notice, platform), NOTICE_FN]),
    "",
  ].join("\n");
}

/** A string as a fish single-quoted literal, where only `\` and `'` are escaped. */
function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/**
 * fish's `--init-command`: the same function as bash's and zsh's, run once now and then on every
 * `fish_prompt` event, which fish emits before each prompt.
 *
 * fish runs a prompt event's handlers in the order they were defined, and defining a function
 * again moves its handler to the end. So the definition is kept in a variable, and the handler
 * defines itself again whenever another handler — not fish's own `__fish_*` ones — comes after
 * it. At the first prompt it prints the notice, if any (see {@link posixNotice} for the bash
 * and zsh form).
 */
function fishPathFirst(
  dirs: readonly string[],
  notice: ShellNotice | null,
  platform: NodeJS.Platform,
): string {
  const quoted = dirs.map((dir) => fishQuote(posixDir(dir, platform)));
  const leads = quoted.map((dir, i) => `test "$PATH[${i + 1}]" = ${dir}`).join("; and ");
  const handlers =
    "functions --handlers-type generic | string match 'fish_prompt *' | " +
    "string replace 'fish_prompt ' '' | string match -v '__fish_*'";
  const definition = [
    `function ${PATH_FIRST_FN} --on-event fish_prompt`,
    "  set -l s $status",
    `  if not begin; ${leads}; end`,
    "    set -l rest",
    `    for d in $PATH; contains -- $d ${quoted.join(" ")}; or set -a rest $d; end`,
    `    set -gx PATH ${quoted.join(" ")} $rest`,
    "  end",
    '  if test "$argv[1]" != startup',
    `    set -l hooks (${handlers})`,
    `    if test "$hooks[-1]" != ${PATH_FIRST_FN}`,
    `      eval $${PATH_FIRST_FN}_def`,
    "    end",
    "    if set -q __penguin_notice_pending",
    "      set -e __penguin_notice_pending",
    `      ${NOTICE_FN}`,
    "    end",
    "  end",
    "  return $s",
    "end",
  ].join("\n");
  return [
    `set -g ${PATH_FIRST_FN}_def ${fishQuote(definition)}`,
    `eval $${PATH_FIRST_FN}_def`,
    `${PATH_FIRST_FN} startup`,
    ...(notice === null
      ? []
      : [...fishNotice(notice, platform), "set -g __penguin_notice_pending 1"]),
  ].join("\n");
}

/** The notice function for fish, as {@link posixNotice}. */
function fishNotice(notice: ShellNotice, platform: NodeJS.Platform): string[] {
  const roots = [...new Set([notice.root, posixDir(notice.root, platform)])].map(fishQuote);
  const [before, after] = notice.elsewhere.map(fishQuote);
  const elsewhere = (variable: string): string =>
    `printf '\\e[33m%s%s%s\\e[0m\\n' ${before} "${variable}=$${variable}" ${after}`;
  return [
    `function ${NOTICE_FN}`,
    '  set -l h (string replace -r "/+\\$" "" -- "$PENGUIN_HOME")',
    '  if test -n "$PENGUIN_API_URL"',
    `    ${elsewhere("PENGUIN_API_URL")}`,
    `  else if test -n "$PENGUIN_HOME"${roots.map((root) => `; and test "$h" != ${root}`).join("")}`,
    `    ${elsewhere("PENGUIN_HOME")}`,
    "  else",
    `    printf '\\e[2m%s\\e[0m\\n' ${fishQuote(notice.text)}`,
    "  end",
    "end",
  ];
}

/** A string as a PowerShell single-quoted literal, where a quote is escaped by doubling it. */
function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The notice for PowerShell, as {@link posixNotice}, run by `-Command` after the profiles. The
 * comparison is PowerShell's, which ignores case, like the paths it compares on Windows.
 */
function powerShellNotice(notice: ShellNotice): string {
  const [before, after] = notice.elsewhere.map(powerShellQuote);
  const say = (variable: string, value: string): string =>
    `Write-Host (${before} + '${variable}=' + ${value} + ${after}) -ForegroundColor Yellow`;
  return (
    "& { $u = [string]$env:PENGUIN_API_URL; $h = [string]$env:PENGUIN_HOME; " +
    `if ($u) { ${say("PENGUIN_API_URL", "$u")} } ` +
    `elseif ($h -and $h.TrimEnd([char[]]'\\/') -ne ${powerShellQuote(notice.root)}) { ${say("PENGUIN_HOME", "$h")} } ` +
    `else { Write-Host ${powerShellQuote(notice.text)} -ForegroundColor DarkGray } }`
  );
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
