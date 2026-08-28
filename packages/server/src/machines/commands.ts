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
 * COUNT THE HANDSHAKES. A handshake to a distant or loaded host costs tens of seconds — so a
 * step that can ride an existing connection must, and a connection worth having is HELD. Both
 * halves are answered elsewhere: ssh-session.ts keeps one shell per machine for the small
 * commands, forward.ts keeps one forward per machine for everything reached over HTTP. What
 * is left here is the invocations that cannot ride either, and there is one rule for them —
 * a POSIX install is ONE call, the installer going in on ssh's stdin, the same shape as the
 * documented `curl … | sh`, which is what lets the scratch directory, the scp and the cleanup
 * disappear entirely.
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

/**
 * The far side's program directory, and the launcher inside it that everything here runs.
 * Absolute, because sshd's non-login shell has no `~/.local/bin` on PATH — the symlink the
 * installer drops there is for a person at a terminal, not for us.
 *
 * `$HOME/.penguin` is where install.sh puts it (`PENGUIN_INSTALL_DIR`, defaulting there),
 * laid out as bin/ lib/ web/ node/, with the launcher exec'ing `node/bin/node lib/dist/…`
 * (scripts/launchers/penguin). A remote's own override of that variable is not visible over
 * a non-interactive ssh, so the default is the only thing this side can assume — the same
 * assumption detect.ts makes to find the manifest.
 *
 * One constant because this was written three times and two of them named
 * `$XDG_DATA_HOME/penguin`, a directory nothing in the repo creates: starting a remote
 * server could not work at all, and the upgrade applier only ever ran through its bare-node
 * fallback — on machines that carry their own runtime precisely so they need no system node.
 */
export const REMOTE_PROGRAM_DIR = "$HOME/.penguin";
/** The installed launcher, quoted for a POSIX shell. */
export const REMOTE_PENGUIN = `"${REMOTE_PROGRAM_DIR}/bin/penguin"`;

// --- tunnelling to that server ---------------------------------------------------------------

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

/**
 * `ssh -N -L <local>:127.0.0.1:<remote> <alias>` — a forward this side uses itself, never a
 * browser.
 *
 * The two ports DIFFER here, where tunnelArgs keeps them equal. That equality exists for one
 * reason: a browsing session follows preview URLs, and those are built from the server's own
 * bound port (preview-token.ts). Nothing built from this forward is ever shown to a browser,
 * so it takes whatever this side has free — which is what lets a machine sitting on the
 * default port be reached by a controller that is itself on the default port.
 */
export function forwardArgs(target: RemoteTarget, localPort: number, remotePort: number): string[] {
  for (const port of [localPort, remotePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  }
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
    `${localPort}:127.0.0.1:${remotePort}`,
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
