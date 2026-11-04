/**
 * The commands a remote install runs ON THE MACHINE, plus the small ones the far side
 * executes. Pure, so every command this app would run against someone's machine is
 * unit-visible. How a command gets there — which program carries it, with which arguments — is
 * the machine's kind's (mechanisms/machines.ts); nothing here names ssh or any other client.
 *
 * Three things run through a remote SHELL — probe, run the release installer, unpack the
 * replicated hmr store — and each has a POSIX and a Windows form, because a default Windows
 * OpenSSH session is cmd.exe, where `;`, `$VAR`, `'…'` and `rm` mean nothing. The installer
 * itself is the ordinary one (install.sh, install.ps1), downloading the pinned release from
 * the remote's own network.
 *
 * COUNT THE ROUND TRIPS. A handshake to a distant or loaded host costs tens of seconds — so
 * everything rides the ONE connection transport/shell-session.ts holds per machine: commands,
 * the installer and the store on its stdin, every TCP connection dialled while it is up. A
 * POSIX install is therefore the installer going in on that stdin, the same shape as the
 * documented `curl … | sh`, which is what lets the scratch directory, the copy and the cleanup
 * disappear entirely.
 */
import type { RemotePlatform } from "./detect.js";
import type { RemoteLayout } from "./layout.js";

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

/** A machine as the host addresses it (transport/connection.ts). */
export type { RemoteTarget } from "./transport/index.js";
export type { ForwardDirection, ForwardSpec } from "../mechanisms/machines.js";

/**
 * How a machine that signs in with a stored password gets it to ssh. Kept — with the
 * transport/login.ts machinery, which reads it — for the day password sign-in is grafted
 * onto a kind; nothing dials with it today (the kinds carry no password path).
 */
export interface LoginTarget {
  /** Alias as written in ~/.ssh/config — what the user picked. */
  alias: string;
  /** Login account. Empty means "whatever ssh resolves", i.e. no -o User override. */
  user: string;
  /**
   * Present when this machine signs in with a password this server stores for its alias. The
   * password itself is not here: `read` fetches it at the moment a connection opens, and it
   * reaches ssh only through that child's environment (transport/login.ts).
   */
  password?: PasswordLogin;
  /**
   * Present when the target was built for this server's own automatic work on the machine (a
   * reconnect attempt, a connection check, a hand-over): aborted when that work is cut, which
   * ends the command it has running and answers every later one without starting it.
   */
  signal?: AbortSignal;
}

/** How a machine that signs in with a password gets it to ssh. */
export interface PasswordLogin {
  /** The askpass helper: prints the password ssh's child environment carries. Holds no secret. */
  askpass: string;
  /** The stored password now; null when none is stored any more. */
  read: () => string | null;
}

/**
 * The CLI these commands run on a machine: the one PUSHED to it, not the one installed.
 *
 * Run out of the layout's program directory by absolute path, because sshd's non-login
 * shell has no `~/.local/bin` on PATH — the symlink the installer drops there is for a
 * person at a terminal, not for us. The directory is laid out as bin/ lib/ web/ node/ by
 * install.sh (`PENGUIN_INSTALL_DIR`, which runInstallScriptCommand names), with the
 * launcher exec'ing `node/bin/node lib/dist/…` (scripts/launchers/penguin). The data root
 * rides along as PENGUIN_HOME: the CLI's `server status`, `server stop` and `auth token`
 * all act on the root they are given, and the profile's root is not the default one.
 * The profile rides along too, as PENGUIN_PROFILE: the server started by this command
 * reaches machines of its own, and it reads its layout from that variable (layout.ts) —
 * without it a dev-profile server would reach the NEXT machine's release installation.
 * Named for the release profile as well, so an account that exports the variable cannot
 * turn a release server into a dev one.
 *
 * `bin/penguin` is the released program, and a release only carries the subcommands this
 * side asks for (`server status`, `auth token`, `server --detach`) once a release has
 * shipped them. Reaching a machine would then be impossible until the next release —
 * including for the build that introduces reaching machines at all.
 *
 * `dist/penguin-hmr.js` is the entry that loads the CLI out of that machine's own hmr store
 * (packages/cli/src/penguin-hmr.ts), which is the CLI this server pushed there. It has
 * shipped in the archive since long before any of this, so a machine installed by any
 * release can run the current CLI. What it cannot do is run one that was never pushed: a
 * machine with an empty store answers `no CLI pushed to <root>`, and the remedy is to
 * install — which replicates the store on its way through (install-server.ts). Every install
 * carries one: a pushed server's own state, the image a release ships (shipped-image.ts), or
 * the image a checkout builds (checkout-image.ts).
 *
 * Invoked through the bundled runtime rather than the launcher, because there is no
 * launcher for this entry. Machines installed from here always carry that runtime: the
 * install runs install.sh without `--universal`, which is the only mode that omits it.
 *
 * Spelled in the dialect of the shell that will read it. A Windows sshd hands a command to
 * cmd.exe, where `$HOME` is four literal characters and the bundled runtime is
 * `node\node.exe` (scripts/launchers/penguin.cmd) — so the POSIX form is not "not found"
 * there, it is a different sentence. `%USERPROFILE%` is what install.ps1 defaults to.
 */
export function remotePenguin(platform: RemotePlatform, layout: RemoteLayout): string {
  if (platform === "win32") {
    const dir = layout.programDir.win;
    return `set "PENGUIN_HOME=${layout.dataRoot.win}" & set "PENGUIN_PROFILE=${layout.profile}" & "${dir}\\node\\node.exe" "${dir}\\lib\\dist\\penguin-hmr.js"`;
  }
  const dir = layout.programDir.posix;
  // `env`, not a bare `VAR=value` prefix: startServerCommand puts `nohup` in front of this,
  // and nohup takes the first word as the program — a bare assignment there is "no such
  // command", and the server never starts.
  return `env PENGUIN_HOME="${layout.dataRoot.posix}" PENGUIN_PROFILE=${layout.profile} "${dir}/node/bin/node" "${dir}/lib/dist/penguin-hmr.js"`;
}

/**
 * The Node the installed program carries on a POSIX machine, as a shell word (it names
 * `$HOME`): what a kind without a TCP path of its own runs its one-line bridge with
 * (mechanisms/machines.ts `MachineDial.node`). Laid out by install.sh, as remotePenguin says.
 */
export function remoteNode(layout: RemoteLayout): string {
  return `"${layout.programDir.posix}/node/bin/node"`;
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
 * `release` names what the installer installs: a release tag (`v` + semver; the caller
 * validated the spelling, and the quoting here keeps it one word regardless), which it then
 * downloads itself, or — POSIX only — a package already on that machine (`archive`, a path
 * there), which this server carried over because the machine cannot reach the release
 * sources. install.sh takes one or the other, never both.
 */
export function runInstallScriptCommand(
  release: string | { archive: string },
  where: { platform: "linux" | "darwin" } | { platform: "win32"; scriptPath: string },
  layout: RemoteLayout,
): { command: string; scriptOnStdin: boolean } {
  const versionTag = typeof release === "string" ? release : null;
  // The program directory is named on every install, release profile included: the
  // installer's default happens to match that profile, but the far side's own override of
  // PENGUIN_INSTALL_DIR would not be visible here, and the rest of these commands assume
  // the layout they were given.
  //
  // `--no-modify-path` for a layout that does not own the machine's `penguin` command: the
  // installer would otherwise repoint `~/.local/bin/penguin` (or extend the user Path) at
  // this program directory, and a person typing `penguin` there would run the dev program
  // against the release data root.
  if (where.platform === "win32") {
    if (versionTag === null) throw new Error("a carried package installs on POSIX machines only");
    const script = cmdQuote(where.scriptPath);
    return {
      command:
        `set "PENGUIN_INSTALL_DIR=${layout.programDir.win}" & ` +
        `powershell -NoProfile -ExecutionPolicy Bypass -File ${script} -Version ${cmdQuote(versionTag)}` +
        (layout.ownsCommand ? "" : " -NoModifyPath") +
        ` & del /q ${script}`,
      scriptOnStdin: false,
    };
  }
  const source =
    versionTag === null
      ? `PENGUIN_ARCHIVE=${shQuote((release as { archive: string }).archive)}`
      : `PENGUIN_VERSION=${shQuote(versionTag)}`;
  return {
    command:
      `PENGUIN_INSTALL_DIR="${layout.programDir.posix}" ${source} sh -s` +
      (layout.ownsCommand ? "" : " -- --no-modify-path"),
    scriptOnStdin: true,
  };
}

/**
 * Unpacks the replicated hmr state (harness.json + store/), streamed to the session's stdin as
 * one tar.gz, into the remote's HMR DIRECTORY. `tar` reads stdin with `-f -` on both sides;
 * Windows 10+ ships bsdtar.
 *
 * `<data root>/hmr`, not the data root itself: the members are named relative to the sending
 * side's own hmr directory (install-server.ts tars `-C <root>/hmr harness.json store`), so
 * the two `-C` arguments have to name the same layer. Extracting one directory too high
 * writes a `harness.json` and a `store/` that nothing reads — hmr/host.ts fixes the layout at
 * `<root>/hmr` — and the machine goes on answering with whatever it held before, so the
 * replication reports success and achieves nothing.
 */
export function unpackStoreCommand(platform: RemotePlatform, layout: RemoteLayout): string {
  if (platform === "win32") {
    const root = `${layout.dataRoot.win}\\hmr`;
    return `(if not exist ${cmdQuote(root)} mkdir ${cmdQuote(root)}) & tar -xzf - -C ${cmdQuote(root)}`;
  }
  const root = `${layout.dataRoot.posix}/hmr`;
  return `mkdir -p "${root}" && tar -xzf - -C "${root}"`;
}

/**
 * Starts the installed server in the background and returns at once; readiness is the
 * caller's probe. `setsid` (where the host has it — Linux does, macOS does not) puts the server
 * in a session of its own: started from this side's ssh session it would otherwise belong to
 * that session, and when the connection drops — the hub's laptop sleeps, the network blips —
 * sshd hangs the session up and the server dies with it, taking every program it runs along.
 * `nohup` alone does not cover that: the server's own child resets SIGHUP. In a backgrounded
 * job `setsid` execs in place (the job is no process group leader), so `$!` is still the
 * server's pid. `nohup` and the redirections cover the rest, and the log is the far side's own
 * words when it comes up and dies.
 *
 * Prints the launched process's pid (`$!`) as its only output, so the caller can tell a
 * server that is still coming up from one that already died (launchedPid, isAliveCommand).
 */
export function startServerCommand(port: number, layout: RemoteLayout): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  const root = layout.dataRoot.posix;
  // --host is PINNED, not defaulted: the CLI falls back to the HOST environment variable when
  // it is omitted, so a login shell carrying HOST=0.0.0.0 would put that machine's server on
  // every interface. This side only ever reaches it through the one session, at loopback
  // on the far end, so binding wider is exposure with nothing asking for it.
  return `mkdir -p "${root}" && nohup ${remotePenguin("linux", layout)} server --host 127.0.0.1 --port ${port} >> "${root}/server.log" 2>&1 < /dev/null & echo $!`;
  // every interface. This side only ever reaches it as a channel inside the ssh session, at
  // loopback on the far end, so binding wider is exposure with nothing asking for it.
  return `mkdir -p "${root}" && PENGUIN_SETSID=$(command -v setsid || true); $PENGUIN_SETSID nohup ${remotePenguin("linux", layout)} server --host 127.0.0.1 --port ${port} >> "${root}/server.log" 2>&1 < /dev/null & echo $!`;
}

/** The pid startServerCommand printed; null when the output holds none. */
export function launchedPid(stdout: string): number | null {
  const lines = stdout.trim().split(/\r?\n/);
  const last = lines[lines.length - 1]?.trim() ?? "";
  return /^[1-9]\d*$/.test(last) ? Number(last) : null;
}

/** Answers `alive` or `gone` for a pid on the far side. */
export function isAliveCommand(pid: number): string {
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`bad pid ${pid}`);
  return `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`;
}

/**
 * Removes the installed program from a POSIX machine — what install.sh put in the layout's
 * program directory (`bin`, `lib`, `web`, `node`, and the staging and backup directories an
 * interrupted install can leave) — and, with `removeData`, the data root inside it. Nothing
 * else in that directory is touched, and the directory itself goes only if it is left empty.
 * The release layout also owns the machine's `penguin` command: its symlink goes when it still
 * points into this program directory, and is left alone when something else has taken the name.
 *
 * Its server must be stopped first; this does not stop it. Prints one line per thing removed.
 */
export function uninstallCommand(layout: RemoteLayout, removeData: boolean): string {
  const parts = [
    `dir="${layout.programDir.posix}"`,
    `[ -d "$dir" ] || { echo "nothing installed at $dir"; exit 0; }`,
    `rm -rf "$dir/bin" "$dir/lib" "$dir/web" "$dir/node" "$dir"/.staging.* "$dir"/.old.* || exit 1`,
    `echo "removed $dir/bin, lib, web and node"`,
  ];
  if (layout.ownsCommand) {
    parts.push(
      `link="$HOME/.local/bin/penguin"`,
      `if [ -L "$link" ] && [ "$(readlink "$link")" = "$dir/bin/penguin" ]; then rm -f "$link" && echo "removed $link"; fi`,
    );
  }
  if (removeData) {
    parts.push(`rm -rf "$dir/data" || exit 1`, `echo "removed $dir/data"`);
  }
  // An empty directory is all that is left when nothing else lived there.
  parts.push(`rmdir "$dir" 2>/dev/null && echo "removed $dir"; exit 0`);
  return parts.join("; ");
}

/** The last lines of that log, for a start that did not answer. */
export function serverLogTail(layout: RemoteLayout): string {
  return `tail -n 20 "${layout.dataRoot.posix}/server.log" 2>/dev/null`;
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
 *
 * Exit 3 means there is no such directory; exit 4 means there is one and it may not be read
 * (a folder without the search bit, or one macOS privacy protection holds back — `ls` fails
 * there while `[ -r ]` still says yes, so the listing itself is what is tested). The listing
 * is taken before anything is printed, so a refusal leaves no half-written answer behind.
 */
export function listDirsCommand(dir: string): string {
  const target = dir === "" ? '"$HOME"' : shQuote(dir);
  return [
    `[ -d ${target} ] || exit 3`,
    `cd ${target} 2>/dev/null || exit 4`,
    `listing=$(ls -1p 2>/dev/null) || exit 4`,
    `pwd -P`,
    `echo ${DIR_LIST_MARK}`,
    // -1 one per line, trailing slash marks directories, then keep only those.
    `printf '%s\\n' "$listing" | grep '/$' | sed 's:/$::' | grep -v '^\\.' || true`,
  ].join("; ");
}
