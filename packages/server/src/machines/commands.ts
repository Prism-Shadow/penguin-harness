/**
 * The exact ssh/scp invocations a remote install runs, built as argv arrays (no shell on this
 * side) plus the small commands the far side executes. Pure, so every command this app would
 * run against someone's machine is unit-visible.
 *
 * Only four things ever run through a remote SHELL — probe, make a scratch directory, unpack
 * the runtime, start the installer — and each has a POSIX and a Windows form, because a
 * default Windows OpenSSH session is cmd.exe, where `;`, `$VAR`, `'…'` and `rm` mean nothing.
 * Everything past the fourth step runs under the Node runtime we just put there, on one
 * script for all platforms.
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
 * Unpacks the Node runtime archive beside the installer. `tar -xf` handles both shapes we
 * send — a .tar.gz on POSIX, and a .zip on Windows, where the bundled bsdtar reads zips.
 */
export function extractRuntimeCommand(
  platform: RemotePlatform,
  archivePath: string,
  destDir: string,
): string {
  const archive = quoteFor(platform, archivePath);
  const dest = quoteFor(platform, destDir);
  return `tar -xf ${archive} -C ${dest}`;
}

/**
 * Runs the installer on the runtime that was just unpacked. No arguments: the installer reads
 * `job.json` from its own directory, so nothing has to survive another round of quoting.
 */
export function runInstallerCommand(
  platform: RemotePlatform,
  scratchDir: string,
  /** The unpacked runtime to run it with, or null when the remote's own node is new enough. */
  runtimeDirName: string | null,
): string {
  const sep = platform === "win32" ? "\\" : "/";
  const script = [scratchDir, "remote-installer.cjs"].join(sep);
  if (runtimeDirName === null) return `node ${quoteFor(platform, script)}`;
  const nodeBin = [
    scratchDir,
    runtimeDirName,
    ...(platform === "win32" ? ["node.exe"] : ["bin", "node"]),
  ].join(sep);
  return `${quoteFor(platform, nodeBin)} ${quoteFor(platform, script)}`;
}

/** Best-effort scratch cleanup; failure here never fails an install that already succeeded. */
export function cleanupCommand(platform: RemotePlatform, dir: string): string {
  return platform === "win32" ? `rmdir /s /q ${cmdQuote(dir)}` : `rm -rf ${shQuote(dir)}`;
}

// --- connecting to an installed server (POSIX only for now) ---------------------------------
//
// The commands below run against a machine the install above already ran on, so the layout is
// known: the launcher at `${XDG_DATA_HOME:-$HOME/.local/share}/penguin/bin/penguin` (absolute —
// sshd's non-login shell has no ~/.local/bin on PATH) and the data root at `~/.penguin/data`,
// which is where the server's lock and log live. They are POSIX-only because starting a
// detached background process from a cmd.exe ssh session is a different mechanism entirely;
// connect refuses a Windows remote rather than pretending.

/** Marker line the state probe prints when the lock's pid is alive. */
export const SERVER_ALIVE_MARK = "---penguin-server-alive---";

/**
 * Reads the remote server's state in one round trip: the lock file's text, then the alive
 * marker when the pid recorded there answers `kill -0`. The pid is pulled out with sed rather
 * than a JSON parser because the far side only has a shell — the lock is written by
 * JSON.stringify, so `"pid":<digits>` is a stable shape, not a guess.
 */
export function readServerStateCommand(): string {
  return [
    `lock="$HOME/.penguin/data/server.lock"`,
    `if [ -f "$lock" ]; then cat "$lock"; pid=$(sed -n 's/.*"pid":\\([0-9][0-9]*\\).*/\\1/p' "$lock"); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo; echo ${SERVER_ALIVE_MARK}; fi; fi`,
  ].join("; ");
}

/**
 * Starts the installed server detached on the given port, logging to the data root. `nohup`
 * plus full stream redirection is the portable form (`setsid` does not exist on macOS); the
 * ssh session then has nothing to wait for and exits at once. The port is a validated integer
 * on this side, so nothing here needs quoting beyond the paths.
 */
export function startServerCommand(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  return [
    `bin="\${XDG_DATA_HOME:-$HOME/.local/share}/penguin/bin/penguin"`,
    `mkdir -p "$HOME/.penguin/data"`,
    `PORT=${port} HOST=127.0.0.1 nohup "$bin" server </dev/null >>"$HOME/.penguin/data/server.log" 2>&1 &`,
  ].join("; ");
}

/** Asks the server to go away politely (TERM); liveness is re-checked by the state probe. */
export function stopServerCommand(pid: number): string {
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`bad pid ${pid}`);
  return `kill ${pid} 2>/dev/null || true`;
}

/** The last lines of the remote server's log — the far side's own words when a start fails. */
export function serverLogTailCommand(lines = 20): string {
  return `tail -n ${lines} "$HOME/.penguin/data/server.log" 2>/dev/null || true`;
}

/**
 * The remote's stored initial admin password (the server keeps the seed plaintext at
 * `<data root>/initial-admin-password` until the password is changed — see the server's
 * initial-password module). Empty when already changed or never stored: a fresh install's
 * first sign-in needs this told to the user, or the remote is a locked door.
 */
export function readInitialPasswordCommand(): string {
  return `cat "$HOME/.penguin/data/initial-admin-password" 2>/dev/null || true`;
}

/**
 * The remote's identity as `<machine>:<account>` — machine-id where the OS keeps one,
 * hostname otherwise. Compared with this server's own fingerprint to refuse SELF-connects:
 * an alias that resolves to the machine and account this server already runs on would
 * install over its own program directory, and the port-conflict path could kill the very
 * server serving the request.
 */
export function identityFingerprintCommand(): string {
  return `mid=$(cat /etc/machine-id 2>/dev/null || hostname 2>/dev/null); echo "$mid:$(id -un 2>/dev/null)"`;
}

/**
 * `ssh -N -L <port>:127.0.0.1:<port> <alias>` — the tunnel that makes the remote server a
 * loopback origin here. Local and remote port are the SAME number by design: preview URLs are
 * built from the server's own bound port (preview-token.ts), so the two must stay equal.
 * ExitOnForwardFailure turns "local port taken" into an exit instead of a silent no-op
 * tunnel, and the keepalives surface a dead link within a minute.
 */
export function tunnelArgs(target: RemoteTarget, port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  return [
    ...connectionOptions(target),
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-L",
    `${port}:127.0.0.1:${port}`,
    target.alias,
  ];
}
