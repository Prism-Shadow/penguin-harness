/**
 * The exact ssh/scp invocations the remote install runs, built as argv arrays (no shell on
 * this side) plus the small shell snippets the far side executes. Pure, so every command
 * this app would run against someone's machine is unit-visible.
 *
 * Two rules encoded here:
 * - **BatchMode.** A GUI app has no terminal: an ssh that decides to ask for a password or
 *   a key passphrase would hang forever with nothing to type into. BatchMode turns that into
 *   an immediate, readable failure, which the caller surfaces verbatim — v1 is key/agent
 *   auth, exactly as the design says.
 * - **The user override rides the command line, never the config.** `-o User=…` selects the
 *   account for this connection; `~/.ssh/config` is read-only to us.
 */

/** Wraps a value for the REMOTE shell. Single quotes are literal there, except for `'` itself. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface RemoteTarget {
  /** Alias as written in ~/.ssh/config — what the user picked. */
  alias: string;
  /** Login account. Empty means "whatever ssh resolves", i.e. no -o User override. */
  user: string;
}

/** Options shared by every connection this module opens. */
function connectionOptions(target: RemoteTarget): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...(target.user === "" ? [] : ["-o", `User=${target.user}`]),
  ];
}

/** `ssh <options> <alias> <remote sh command>`. */
export function sshArgs(target: RemoteTarget, remoteCommand: string): string[] {
  return [...connectionOptions(target), target.alias, remoteCommand];
}

/**
 * `scp <options> <files…> <alias>:<dir>/`. scp takes the same -o options as ssh, so the
 * BatchMode guarantee holds for the transfer too.
 */
export function scpArgs(target: RemoteTarget, localFiles: string[], remoteDir: string): string[] {
  return [
    ...connectionOptions(target),
    ...localFiles,
    // The remote path is interpreted by a shell on the far side, hence the quoting.
    `${target.alias}:${shQuote(remoteDir)}/`,
  ];
}

/** Asks the remote for a private scratch directory instead of inventing a path in /tmp. */
export const MAKE_TEMP_DIR_COMMAND = "mktemp -d";

/**
 * Runs the installer that was just copied over. `--universal` is required, not cosmetic:
 * the payload this app pushes carries no Node runtime, and install.sh validates the package
 * manifest against the target it expects — without the flag it refuses with
 * "package target mismatch: expected linux-x64, found universal".
 */
export function installCommand(remoteDir: string, archiveName: string): string {
  const installer = shQuote(`${remoteDir}/install.sh`);
  const archive = shQuote(`${remoteDir}/${archiveName}`);
  return `sh ${installer} --universal --archive ${archive}`;
}

/** Best-effort scratch cleanup; failure here never fails an install that already succeeded. */
export function cleanupCommand(remoteDir: string): string {
  return `rm -rf ${shQuote(remoteDir)}`;
}
