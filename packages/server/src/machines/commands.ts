/**
 * The exact ssh/scp invocations a remote install runs, built as argv arrays (no shell on this
 * side) plus the small commands the far side executes. Pure, so every command this app would
 * run against someone's machine is unit-visible.
 *
 * Only three things ever run through a remote SHELL — probe, make a scratch directory, run
 * the installer — and each has a POSIX and a Windows form, because a default Windows OpenSSH
 * session is cmd.exe, where `;`, `$VAR`, `'…'` and `rm` mean nothing. The installer itself is
 * the ordinary one (install.sh, install.ps1), fed the payload we scp beside it.
 *
 * Two further rules encoded here:
 * - **BatchMode.** A GUI app has no terminal: an ssh that decides to ask for a password or a
 *   key passphrase would hang forever with nothing to type into. BatchMode turns that into an
 *   immediate, readable failure — v1 is key/agent auth, exactly as the design says.
 * - **The user override rides the command line, never the config.** `-o User=…` selects the
 *   account for this connection; `~/.ssh/config` is read-only to us.
 */
import type { RemotePlatform } from "./detect.js";

/** Wraps a value for a POSIX remote shell. Single quotes are literal there, except `'` itself. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Wraps a value for cmd.exe. There is no escape for `"` inside a quoted string, so a path
 * containing one is refused rather than mis-executed — it cannot occur in a Windows path
 * anyway, and guessing would be worse than saying so.
 */
export function cmdQuote(value: string): string {
  if (value.includes('"')) throw new Error(`cannot quote for cmd.exe: ${value}`);
  return `"${value}"`;
}

export const quoteFor = (platform: RemotePlatform, value: string): string =>
  platform === "win32" ? cmdQuote(value) : shQuote(value);

export interface RemoteTarget {
  /** Alias as written in ~/.ssh/config — what the user picked. */
  alias: string;
  /** Login account. Empty means "whatever ssh resolves", i.e. no -o User override. */
  user: string;
}

function connectionOptions(target: RemoteTarget): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...(target.user === "" ? [] : ["-o", `User=${target.user}`]),
  ];
}

/** `ssh <options> <alias> <remote command>`. */
export function sshArgs(target: RemoteTarget, remoteCommand: string): string[] {
  return [...connectionOptions(target), target.alias, remoteCommand];
}

/**
 * `scp <options> <files…> <alias>:<dir>`. The remote path is NOT quoted: current OpenSSH
 * transfers over SFTP, where the path is taken literally and quotes would become part of the
 * name. Scratch directories are chosen without quotes or shell metacharacters for that reason.
 */
export function scpArgs(target: RemoteTarget, localFiles: string[], remoteDir: string): string[] {
  return [...connectionOptions(target), ...localFiles, `${target.alias}:${remoteDir}`];
}

/**
 * Creates a scratch directory and prints its path. POSIX gets `mktemp -d`; Windows builds one
 * under %TEMP% from a name the caller generated, because cmd.exe has no mktemp.
 */
export function makeScratchCommand(platform: RemotePlatform, name: string): string {
  if (platform === "win32") {
    return `mkdir "%TEMP%\\${name}" & echo %TEMP%\\${name}`;
  }
  return `d=$(mktemp -d) && mkdir -p "$d/${name}" && echo "$d/${name}"`;
}

/**
 * Runs the ordinary installer against the payload scp put beside it. No arguments: both
 * installers pick up a sibling payload on their own (their offline mode), so nothing has to
 * survive another round of quoting. `-ExecutionPolicy Bypass` because client Windows defaults
 * to Restricted, and this is our own script arriving over our own ssh session.
 */
export function runInstallScriptCommand(platform: RemotePlatform, scratchDir: string): string {
  if (platform === "win32") {
    const script = cmdQuote(`${scratchDir}\\install.ps1`);
    return `powershell -NoProfile -ExecutionPolicy Bypass -File ${script}`;
  }
  return `sh ${shQuote(`${scratchDir}/install.sh`)}`;
}

/** Best-effort scratch cleanup; failure here never fails an install that already succeeded. */
export function cleanupCommand(platform: RemotePlatform, dir: string): string {
  return platform === "win32" ? `rmdir /s /q ${cmdQuote(dir)}` : `rm -rf ${shQuote(dir)}`;
}
