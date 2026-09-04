/**
 * ONE connection per machine: `ssh -T -D <port> <alias> sh`, held open.
 *
 * Everything this server does to a machine goes over it. Commands are fed to the shell's
 * stdin and answered on its stdout; a script or a tarball rides the same stdin as a heredoc;
 * every TCP connection to the machine — its API, its update endpoint — is dialled through
 * the `-D` SOCKS port as a channel inside this same session (socks.ts). Nothing else opens
 * ssh to a machine while this is up, and a second ask for anything queues behind the first.
 * VS Code Remote-SSH is built the same way, for the same reason: Win32 OpenSSH has no
 * ControlMaster, so one connection means never starting a second process.
 *
 * FRAMING. Each command is wrapped so its end is unambiguous:
 *
 *     ( <command> ) 2>&1 ; printf '\n<mark> %s\n' "$?"
 *
 * A SUBSHELL, so a command containing `exit` cannot end the shell and a `cd` cannot leak. The
 * mark is random per session, so nothing a command prints can forge it. Output and errors are
 * MERGED — separating them over one pipe needs temp files — and that is in the type: the
 * result is `output`, not `stdout`/`stderr`. With an input, the command reads it from stdin:
 *
 *     ( <decode> | ( <command> ) ) <<'EOF_<mark>' 2>&1 ; printf …
 *     <base64 of the input>
 *     EOF_<mark>
 *
 * base64 because a heredoc carries text, and the terminator cannot occur in its alphabet.
 * <decode> is DECODE below, which settles the flag on the far side rather than here.
 *
 * UNSUPERVISED: a session that dies is dropped and the next command opens a new one.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { sessionArgs } from "../commands.js";
import type { RemoteTarget } from "../commands.js";

/**
 * What a command in the session produced. `output` is stdout and stderr merged, with the
 * command's own trailing newline kept — the same shape execFile hands back, so a caller
 * parses one channel identically whichever way the command reached the machine.
 */
export interface ShellResult {
  code: number;
  output: string;
}

export interface ShellRunOptions {
  /** Bytes the command reads from its stdin, carried as a heredoc. */
  input?: Buffer;
  /** Each complete line of output as it arrives — an install takes minutes. */
  onLine?: (line: string) => void;
  /** A command that has not finished in this long is treated as a hung session. */
  timeoutMs?: number;
}

/** The held session: the ssh child, and the loopback port its SOCKS listener is on. */
export interface ShellSession {
  pid: number;
  socksPort: number;
}

/** How long an idle session is kept before it is let go. */
const IDLE_MS = 10 * 60_000;

/** The default: enough for a probe, a directory listing, a token mint. */
const COMMAND_TIMEOUT_MS = 60_000;

/** Opening is a handshake to a host that may be far away or loaded. */
const OPEN_TIMEOUT_MS = 30_000;

/**
 * Decoding the heredoc, on either base64 there is. GNU coreutils spells decode `-d` and
 * rejects `-D`; the BSD base64 macOS ships spells it `-D`, and releases before Ventura reject
 * `-d`. There is no flag both accept, so the far side picks: the candidate is tried on an
 * empty input of its own — a pipe from printf — which leaves the heredoc on stdin untouched
 * for whichever invocation wins. No round trip, and nothing here has to know the platform.
 */
const DECODE = "if printf '' | base64 -d >/dev/null 2>&1; then base64 -d; else base64 -D; fi";

/** A local port nothing is on: the kernel's answer, bound and released rather than guessed. */
function freeLocalPort(): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      probe.close(() => resolve(port));
    });
  });
}

interface Pending {
  resolve: (r: ShellResult) => void;
  timer: NodeJS.Timeout;
  onLine: ((line: string) => void) | undefined;
}

class MachineShell {
  #child: ChildProcessWithoutNullStreams | null = null;
  #socksPort: number | null = null;
  #buffer = "";
  /** How far into #buffer lines have been handed to the pending command's onLine. */
  #emitted = 0;
  #mark = "";
  #stderr = "";
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idle: NodeJS.Timeout | null = null;

  constructor(private readonly target: RemoteTarget) {}

  /** Runs one command, opening the session if needed. Never throws; a dead session is a failure. */
  run(command: string, opts: ShellRunOptions = {}): Promise<ShellResult> {
    const next = this.#queue.then(() => this.#runExclusive(command, opts));
    // The queue must survive a rejection, or one failure would stall every later command.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** The session while it is up — pid and SOCKS port — or null. */
  session(): ShellSession | null {
    const pid = this.#child?.pid;
    return pid !== undefined && this.#socksPort !== null
      ? { pid, socksPort: this.#socksPort }
      : null;
  }

  close(): void {
    if (this.#idle !== null) clearTimeout(this.#idle);
    this.#idle = null;
    this.#child?.kill();
    this.#drop();
  }

  #drop(): void {
    this.#child = null;
    this.#socksPort = null;
    this.#buffer = "";
    this.#emitted = 0;
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      // ssh's own last words — a refused key, an unknown host — are the diagnosis.
      const said = this.#stderr.trim().split("\n").pop() ?? "";
      pending.resolve({
        code: 255,
        output:
          said === ""
            ? "the connection to this machine ended"
            : `the connection to this machine ended: ${said}`,
      });
    }
    this.#stderr = "";
  }

  async #open(): Promise<ChildProcessWithoutNullStreams> {
    if (this.#child !== null) return this.#child;
    const port = await freeLocalPort();
    if (port === null) throw new Error("no free local port for the session's SOCKS listener");
    this.#mark = `--penguin-${randomBytes(9).toString("hex")}--`;
    const child = spawn("ssh", sessionArgs(this.target, port), { stdio: ["pipe", "pipe", "pipe"] });
    // setEncoding, not String(chunk): a multibyte character whose bytes land in two `data`
    // events would otherwise decode to two replacement characters. The stream's decoder holds
    // an incomplete sequence back until the rest of it arrives.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#onData(chunk));
    // A write to a session that already died raises EPIPE on this stream ASYNCHRONOUSLY,
    // after the write returned — with no listener that is an unhandled error event, which
    // takes the process down. The command it belonged to is answered by #drop() on exit.
    child.stdin.on("error", () => {});
    // ssh's own stderr is not a command's output (those carry theirs on stdout via 2>&1);
    // it is kept for the moment the session dies, when it is the diagnosis. Decoded by the
    // stream for the same reason stdout is: a banner or a remote MOTD is where non-ASCII
    // reaches this channel, and this text is read by a person when the connection fails.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-4096);
    });
    // "close", not "exit": stderr's last words arrive before close, and they are the diagnosis.
    //
    // Guarded by identity, because a dead child's close event can arrive after its successor is
    // already up: close() kills and drops synchronously, the queue then opens a new session, and
    // the kill's own close lands afterwards. Unguarded, that stale event would drop the
    // replacement and answer ITS command as a connection that ended.
    child.on("close", () => {
      if (this.#child === child) this.#drop();
    });
    child.on("error", () => {
      if (this.#child === child) this.#drop();
    });
    this.#child = child;
    this.#socksPort = port;
    return child;
  }

  #onData(text: string): void {
    this.#buffer += text;
    const at = this.#buffer.indexOf(this.#mark);
    const region = at === -1 ? this.#buffer : this.#buffer.slice(0, at);
    // Complete lines are relayed as they arrive; the framing's own trailing newline is not a line.
    for (
      let nl = region.indexOf("\n", this.#emitted);
      nl !== -1;
      nl = region.indexOf("\n", this.#emitted)
    ) {
      const line = region.slice(this.#emitted, nl);
      this.#emitted = nl + 1;
      if (!(at !== -1 && line === "" && this.#emitted === region.length))
        this.#pending?.onLine?.(line);
    }
    if (at === -1) return;
    const rest = this.#buffer.slice(at + this.#mark.length);
    const end = rest.indexOf("\n");
    if (end === -1) return; // The exit code has not arrived yet.
    const output = region.replace(/\n$/, "");
    const code = Number.parseInt(rest.slice(0, end).trim(), 10);
    this.#buffer = rest.slice(end + 1);
    this.#emitted = 0;
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.resolve({ code: Number.isFinite(code) ? code : 0, output });
    }
  }

  async #runExclusive(command: string, opts: ShellRunOptions): Promise<ShellResult> {
    if (this.#idle !== null) clearTimeout(this.#idle);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = await this.#open();
    } catch (err) {
      return {
        code: 255,
        output: `could not start ssh: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return new Promise<ShellResult>((resolve) => {
      const timer = setTimeout(() => {
        // A session that stopped answering is not one to keep: drop it so the next command
        // opens a fresh connection rather than queueing behind a corpse.
        //
        // The pending command is detached FIRST. close() answers whatever is pending with the
        // connection's last words, and a promise settles once — so leaving it attached would
        // spend this command's one answer on "the connection ended", losing the more precise
        // fact that the machine simply never replied.
        this.#pending = null;
        this.close();
        resolve({ code: 255, output: "the machine did not answer in time" });
      }, opts.timeoutMs ?? COMMAND_TIMEOUT_MS);
      this.#pending = { resolve, timer, onLine: opts.onLine };
      const mark = `printf '\\n${this.#mark} %s\\n' "$?"`;
      if (opts.input === undefined) {
        child.stdin.write(`( ${command} ) 2>&1 ; ${mark}\n`);
        return;
      }
      const end = `EOF_${this.#mark.replaceAll("-", "")}`;
      const body = opts.input.toString("base64").replace(/.{76}/g, "$&\n");
      child.stdin.write(
        `( ${DECODE} | ( ${command} ) ) <<'${end}' 2>&1 ; ${mark}\n${body}\n${end}\n`,
      );
    }).finally(() => {
      this.#idle = setTimeout(() => this.close(), IDLE_MS);
      this.#idle.unref?.();
    });
  }
}

/**
 * The sessions, by machine address. Module-level rather than per App, so ordinary work does
 * not reopen a connection it already has.
 *
 * A hot push DOES lose them: the platform bundle is re-imported cache-busted (hmr/host.ts),
 * so this map starts empty in the successor and the previous generation's ssh children have
 * nothing holding them. What collects them is the idle timer — a scheduled timeout belongs
 * to the process, not to the module that scheduled it, so it still fires and still closes the
 * child it was created for. The cost of a push is one reconnect per machine, within IDLE_MS,
 * and never a child nobody ever kills.
 */
const sessions = new Map<string, MachineShell>();

function shellFor(machineAddress: string, target: RemoteTarget): MachineShell {
  let shell = sessions.get(machineAddress);
  if (shell === undefined) {
    shell = new MachineShell(target);
    sessions.set(machineAddress, shell);
  }
  return shell;
}

/** Runs a command on a machine over its session. */
export function runOnShell(
  machineAddress: string,
  target: RemoteTarget,
  command: string,
  opts: ShellRunOptions = {},
): Promise<ShellResult> {
  return shellFor(machineAddress, target).run(command, opts);
}

/**
 * Brings the session up, or reports why it could not be: the first thing a connect does,
 * and what any TCP dial needs. Idempotent — a session already up is answered from memory.
 */
export async function openShell(
  machineAddress: string,
  target: RemoteTarget,
): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
  const shell = shellFor(machineAddress, target);
  const up = shell.session();
  if (up !== null) return { ok: true, session: up };
  const result = await shell.run(":", { timeoutMs: OPEN_TIMEOUT_MS });
  const session = shell.session();
  if (result.code !== 0 || session === null) {
    return { ok: false, detail: result.output.trim() || "the session did not come up" };
  }
  return { ok: true, session };
}

/** The session held to a machine, while it is up. */
export function sessionOf(machineAddress: string): ShellSession | null {
  return sessions.get(machineAddress)?.session() ?? null;
}

/** Lets go of a machine's session — for a disconnect, or a machine that went away. */
export function closeShell(machineAddress: string): void {
  sessions.get(machineAddress)?.close();
  sessions.delete(machineAddress);
}
