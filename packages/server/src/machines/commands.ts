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

/** The connection flags every ssh/scp here shares; exported for the shared-shell channel. */
export function connectionOptionsFor(target: RemoteTarget): string[] {
  return connectionOptions(target);
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
 * The two forms differ in WHERE THE SCRIPT IS, which is why that is in the type rather than
 * in a comment: POSIX takes it on stdin (`sh -s`, the same shape as the documented
 * `curl … | sh`), so the returned command carries no path and `scriptOnStdin` says the caller
 * must pipe it — the command alone is only half the invocation. Windows cannot: `param()` is
 * not valid in a PowerShell command stream, and `-File -` is PowerShell 7 only while a remote
 * may have 5.1, so the script is copied to a path first and that path is required to build
 * the command at all. Its delete is chained on rather than costing another handshake, and
 * `-ExecutionPolicy Bypass` covers client Windows defaulting to Restricted.
 *
 * `versionTag` is a release tag (`v` + semver); the caller validated the spelling, and the
 * quoting here keeps it one word regardless.
 */
export function runInstallScriptCommand(
  versionTag: string,
  where: { platform: "linux" | "darwin" } | { platform: "win32"; scriptPath: string },
): { command: string; scriptOnStdin: boolean } {
  if (where.platform === "win32") {
    const script = cmdQuote(where.scriptPath);
    return {
      command:
        `powershell -NoProfile -ExecutionPolicy Bypass -File ${script} -Version ${cmdQuote(versionTag)}` +
        ` & del /q ${script}`,
      scriptOnStdin: false,
    };
  }
  return { command: `PENGUIN_VERSION=${shQuote(versionTag)} sh -s`, scriptOnStdin: true };
}

/**
 * Creates a scratch directory and prints its path — for the one path that still puts a file
 * on the far side: a hot upgrade applies through the remote's OWN loopback API, so the
 * applier has to run there. An install needs none of this; its script rides ssh's stdin.
 *
 * POSIX gets `mktemp -d`; Windows builds one under %TEMP% from a name the caller generated,
 * because cmd.exe has no mktemp.
 */
export function makeScratchCommand(platform: RemotePlatform, name: string): string {
  if (platform === "win32") {
    return `mkdir "%TEMP%\\${name}" & echo %TEMP%\\${name}`;
  }
  return `d=$(mktemp -d) && mkdir -p "$d/${name}" && echo "$d/${name}"`;
}

/** Best-effort scratch cleanup; failure here never fails an upgrade that already succeeded. */
export function cleanupCommand(platform: RemotePlatform, dir: string): string {
  return platform === "win32" ? `rmdir /s /q ${cmdQuote(dir)}` : `rm -rf ${shQuote(dir)}`;
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
// --- reading an installed server's state (POSIX only) ---------------------------------------

/** Marker line the state probe prints when the lock's pid is alive over there. */
export const SERVER_ALIVE_MARK = "---penguin-server-alive---";

/** Marker the state probe prints before that machine's own id, when it has minted one. */
export const MACHINE_ID_MARK = "---penguin-machine-id---";

/**
 * Reads the remote server's state in one round trip: the lock file's text, then the alive
 * marker when the pid recorded there answers `kill -0`. The pid is pulled out with sed
 * rather than a JSON parser because the far side only has a shell — the lock is written by
 * JSON.stringify, so `"pid":<digits>` is a stable shape, not a guess.
 *
 * The layout is known because the install put it there: the data root is `~/.penguin/data`,
 * which is where the server writes its lock. POSIX only, like the rest of the
 * server-lifecycle commands: `kill -0` has no cmd.exe equivalent, and a Windows remote
 * simply reads as "cannot tell" rather than being lied about.
 */
export function readServerStateCommand(): string {
  return [
    `lock="$HOME/.penguin/data/server.lock"`,
    `if [ -f "$lock" ]; then cat "$lock"; pid=$(sed -n 's/.*"pid":\\([0-9][0-9]*\\).*/\\1/p' "$lock"); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo; echo ${SERVER_ALIVE_MARK}; fi; fi`,
    // The machine's own id rides the SAME round trip: it is one more file in the same
    // directory, and a probe that already crossed the network should not be followed by a
    // second one to ask who answered it.
    `mid="$HOME/.penguin/data/machine-id"`,
    `if [ -f "$mid" ]; then echo; echo ${MACHINE_ID_MARK}; cat "$mid"; fi`,
  ].join("; ");
}

// --- starting, stopping and tunnelling to that server (POSIX only) --------------------------
//
// These run against a machine the install already ran on, so the layout is known: the
// launcher at `$HOME/.penguin/bin/penguin` (absolute — sshd's
// non-login shell has no ~/.local/bin on PATH) and the data root at `~/.penguin/data`. POSIX
// only because starting a detached background process from a cmd.exe ssh session is a
// different mechanism entirely; connect refuses a Windows remote rather than pretending.

/**
 * Starts the installed server detached on the given port, logging to the data root. `nohup`
 * plus full stream redirection is the portable form (`setsid` does not exist on macOS); the
 * ssh session then has nothing to wait for and exits at once. The port is a validated
 * integer on this side, so nothing here needs quoting beyond the paths.
 */
export function startServerCommand(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  return [
    `bin="$HOME/.penguin/bin/penguin"`,
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
  if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new Error(`bad lines ${lines}`);
  return `tail -n ${lines} "$HOME/.penguin/data/server.log" 2>/dev/null || true`;
}

/**
 * `ssh -N -L <port>:127.0.0.1:<port> <alias>` — the tunnel that makes the remote server a
 * loopback origin here. Local and remote port are the SAME number by design: preview URLs
 * are built from the server's own bound port (preview-token.ts), so the two must stay equal.
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

/** Marker separating the resolved path from the entries in a directory listing. */
export const DIR_LIST_MARK = "---penguin-dirs---";

/**
 * Lists the subdirectories of `dir` on the far side, plus the path it actually resolved to.
 *
 * An empty `dir` means that machine's home, which is the picker's starting point. The path
 * is resolved over THERE (`cd` + `pwd -P`) because only that machine can say what `~` or a
 * symlink means on it — resolving here would be this machine answering a question about
 * another one's filesystem.
 *
 * Hidden directories are dropped, matching what the local browser shows, and everything is
 * quoted for the remote shell by the caller's quoting rules.
 */
export function listDirsCommand(dir: string): string {
  const target = dir === "" ? '"$HOME"' : shQuote(dir);
  return [
    `cd ${target} 2>/dev/null || exit 3`,
    `pwd -P`,
    `echo ${DIR_LIST_MARK}`,
    // -1 one per line, trailing slash marks directories, then keep only those.
    `ls -1p 2>/dev/null | grep '/$' | sed 's:/$::' | grep -v '^\\.' || true`,
  ].join("; ");
}
