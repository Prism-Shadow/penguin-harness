/**
 * Putting a directory at the FRONT of PATH for something the harness spawns.
 *
 * Two forms, because a command needs both. {@link prependPathEnv} writes the child's
 * environment, which is all a directly spawned process (a hook script) ever sees. A
 * command, though, runs through a LOGIN shell, and a login profile routinely prepends
 * `/opt/homebrew/bin` or `/usr/local/bin` to whatever PATH it inherited — so the
 * environment alone leaves the harness's directory behind whatever the profile put in
 * front of it. {@link pathPrependPrefix} is the statement that runs after the profile and
 * decides.
 *
 * Nothing here has an opinion about WHAT is prepended: the host supplies the directories
 * (see `EnvironmentConfig.pathPrepend`).
 */
import path from "node:path";

/**
 * `env` with `dirs` at the front of its PATH entry — a new object; the argument is not
 * touched. An empty list returns it unchanged.
 *
 * The existing entry's own spelling is reused rather than writing `PATH`: Windows resolves
 * environment names case-insensitively but stores the casing it was given, so an
 * environment carrying `Path` would end up with two entries differing only in case, and
 * which one the child reads is not ours to decide.
 */
export function prependPathEnv(env: NodeJS.ProcessEnv, dirs: readonly string[]): NodeJS.ProcessEnv {
  if (dirs.length === 0) return env;
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const current = env[key];
  const prefix = dirs.join(path.delimiter);
  return {
    ...env,
    [key]:
      current === undefined || current === "" ? prefix : `${prefix}${path.delimiter}${current}`,
  };
}

/**
 * Shells that take a Bourne-style `export NAME=value`. Everything the POSIX resolver can
 * pick (see shell.ts) except `fish`, which spells the same thing `set -x` and would fail
 * the whole command on an `export`.
 */
const EXPORT_PATH_SHELLS = new Set(["bash", "sh", "zsh", "ksh", "ksh93", "mksh", "dash", "ash"]);

/** A string as one POSIX shell word: single-quoted, with each embedded quote spliced as `'\''`. */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A string as a PowerShell single-quoted literal, where a quote is escaped by doubling it. */
function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The statement that puts `dirs` at the front of PATH for one command, written in the
 * syntax of the shell that will run it and ending in that shell's separator, so
 * `pathPrependPrefix(...) + cmd` is a command string with the original command still last
 * — untouched, and still the one whose exit status the shell reports.
 *
 * `""` for an empty list, and for any shell whose PATH syntax is not one of the three
 * below — `fish`, and whatever basename `PENGUIN_SHELL` names. A prefix in the wrong
 * dialect would not misconfigure PATH, it would fail every command, so an unrecognized
 * shell keeps the child-environment prepend and nothing more.
 */
export function pathPrependPrefix(shellName: string, dirs: readonly string[]): string {
  if (dirs.length === 0) return "";
  if (shellName === "pwsh" || shellName === "powershell") {
    const prefix = dirs.map((dir) => `${powerShellQuote(dir)} + ';' + `).join("");
    return `$env:PATH = ${prefix}$env:PATH; `;
  }
  // cmd offers no quoting: a `%` in a directory would be read as a variable reference and
  // expanded here. What that costs is a prefix naming the wrong directory, not a mangled
  // PATH — the `;%PATH%` tail is unaffected.
  if (shellName === "cmd") return `set "PATH=${dirs.join(";")};%PATH%" && `;
  if (!EXPORT_PATH_SHELLS.has(shellName)) return "";
  return `export PATH=${dirs.map(posixQuote).join(":")}:"$PATH"; `;
}
