/**
 * The exact ssh/scp invocations a remote install runs, built as argv arrays (no shell on this
 * side) plus the small commands the far side executes. Pure, so every command this app would
 * run against someone's machine is unit-visible.
 *
 * Three things run through a remote SHELL — probe, run the release installer, unpack the
 * replicated hmr store — and each has a POSIX and a Windows form, because a default Windows
 * OpenSSH session is cmd.exe, where `;`, `$VAR`, `'…'` and `rm` mean nothing. The installer
 * itself is the ordinary one (install.sh, install.ps1), downloading the pinned release from
 * the remote's own network.
 *
 * COUNT THE HANDSHAKES. Every one of these is a separate ssh connection, and a handshake to
 * a distant or loaded host costs tens of seconds — so a step that can ride an existing
 * connection must. A POSIX install is one call: the installer goes in on ssh's stdin, the
 * same shape as the documented `curl … | sh`, which is what lets the scratch directory, the
 * scp and the cleanup disappear entirely.
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
 * Runs the ordinary installer on the far side, pinned to this server's own base release so
 * the remote downloads exactly the version this side stands on.
 *
 * POSIX takes the script on stdin (`sh -s`) — no file, so nothing has to be copied, made a
 * place for, or cleaned up afterwards. Windows does not: `param()` is not valid in a
 * PowerShell command stream, and `-File -` is PowerShell 7 only while a remote may have 5.1,
 * so there the script is copied to the home directory and run from a path — with the delete
 * chained onto the same command rather than costing a connection of its own.
 * `-ExecutionPolicy Bypass` because client Windows defaults to Restricted, and this is our
 * own script arriving over our own ssh session.
 *
 * `versionTag` is a release tag (`v` + semver); the caller validated the spelling, and the
 * quoting here keeps it one word regardless.
 */
export function runInstallScriptCommand(
  platform: RemotePlatform,
  versionTag: string,
  /** Where the script was copied on a Windows remote; unused on POSIX, where it rides stdin. */
  remoteScriptPath?: string,
): string {
  if (platform === "win32") {
    const script = cmdQuote(remoteScriptPath ?? "");
    return (
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${script} -Version ${cmdQuote(versionTag)}` +
      ` & del /q ${script}`
    );
  }
  return `PENGUIN_VERSION=${shQuote(versionTag)} sh -s`;
}

/**
 * Unpacks the replicated hmr state (harness.json + store/), streamed to ssh's stdin as one
 * tar.gz, into the remote's default data root — where a server this page installed will look
 * for it on boot (hmr/host.ts's restore). `tar` reads stdin with `-f -` on both sides;
 * Windows 10+ ships bsdtar.
 */
export function unpackStoreCommand(platform: RemotePlatform): string {
  if (platform === "win32") {
    const root = "%USERPROFILE%\\.penguin\\data";
    return `(if not exist ${cmdQuote(root)} mkdir ${cmdQuote(root)}) & tar -xzf - -C ${cmdQuote(root)}`;
  }
  const root = "$HOME/.penguin/data";
  return `mkdir -p "${root}" && tar -xzf - -C "${root}"`;
}
