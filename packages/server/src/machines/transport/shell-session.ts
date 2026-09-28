/**
 * ONE connection per machine: the shell its kind launches (mechanisms/machines.ts
 * `Machine.launch`), held open.
 *
 * Everything this server does to a machine goes over it. Commands are fed to the shell's
 * stdin and answered on its stdout; a script or a tarball rides the same stdin as a heredoc;
 * every TCP connection to the machine is dialled by the kind while this session is up (ssh:
 * through the `-D` SOCKS port the session carries). Nothing else opens a connection to a
 * machine while this is up, and a second ask for anything queues behind the first.
 *
 * WHICH SHELL is the kind's business, and nothing in this file knows it: what is spawned, its
 * arguments, its environment and what the kind needs remembered of the child (`carry`) all
 * come from `launch()`. What IS here is the same for every kind — the framing, the queue, the
 * lifetimes, the registry — so that liveness has one source, the shell this file holds.
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
 * TWO LIFETIMES. A session opened by a passing command — a probe, a listing — is TRANSIENT:
 * it is let go after IDLE_MS without another command. A session someone asked to HOLD (a
 * connect) is kept: it never idles out, and if it dies — a network blip, keepalives giving
 * up on a dead link, a command that timed out — it is reopened on its own, with a backoff,
 * until it is explicitly closed. The proxy's dials ride the held session and never touch a
 * timer, so traffic alone is neither what keeps it nor what could lose it.
 *
 * WHAT A KIND KEEPS. A kind with state of its own on a session — ssh's wanted port forwards and
 * what ssh answered for each — keeps it in the session's `memo()`, and is told when a child
 * comes up (`Machine.up`). Port forwarding is ssh's (plugins/machine-ssh): the host carries no
 * forward, no control socket and no ssh command line, and a kind without forwards says so.
 *
 * A HOT PUSH keeps a held session. The shell object is registered in the runtime's resource
 * registry under `machineSession.v3:<address>` and claimed back by the next generation, the way
 * a pty is: the child, what it carries and the kind's memo all outlive the swap, and the
 * claiming generation binds its own kind handle (`bind`). A transient session is not delivered:
 * it belongs to the generation that opened it.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { Machine } from "../../mechanisms/machines.js";

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

/** The held session: the child the host holds for the machine. What else it carries is the kind's (`carry`). */
export interface ShellSession {
  pid: number;
}

/**
 * The registry group a held session is delivered under — VERSIONED, because a delivered
 * object keeps the CODE of the generation that made it: a successor that claims it runs the
 * predecessor's methods, whatever this file says now. The resource-interface check
 * (hmr/platform.ts DECLARED_RESOURCES) refuses a group whose declared members the successor
 * cannot find, never one whose members merely BEHAVE differently — so whenever this class
 * changes in a way an old object must not keep (how forwards are carried, what a fact means),
 * bump the suffix here and in DECLARED_RESOURCES: the successor then declares a group the
 * predecessor did not, the predecessor's group is disposed (its sessions closed), and the
 * successor re-holds each machine with objects of its own. One reconnect per machine, once.
 *
 * v2 (2026-09-22): forwards ride the session on a Windows hub too (start arguments, reopen
 * on change); a v1 object recorded the wanted set and never asked ssh for it.
 *
 * v3 (2026-09-28): the session no longer knows ssh. It spawns what its machine's kind launches,
 * and port forwards left the contract for the ssh kind's own extension (plugins/machine-ssh);
 * `setForwards` / `forwardFacts` are gone and `bind` / `carry` / `said` / `reopen` / `memo` are
 * new. A v2 object would still spawn ssh itself and keep its forwards where no v3 code looks.
 */
export const SESSION_GROUP = "machineSession.v3";
const sessionResourceId = (address: string): string => `${SESSION_GROUP}:${address}`;
/** Registry id of the leaving build's closed shape of MachineSession — in the group, so it goes with it. */
export const SESSION_SHAPE_ID = `${SESSION_GROUP}:shape`;
/** MachineSession's key in the generated interface table (ifaces.json). */
export const MACHINE_SESSION_IFACE = "@prismshadow/penguin-server#MachineSession";

/** How long an idle session is kept before it is let go. */
const IDLE_MS = 10 * 60_000;

/** The default: enough for a probe, a directory listing, a token mint. */
const COMMAND_TIMEOUT_MS = 60_000;

/** Opening is a handshake to a host that may be far away or loaded. */
const OPEN_TIMEOUT_MS = 30_000;

/** A held session that dropped is reopened after this long, doubling per failure up to the cap. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

/**
 * Decoding the heredoc, on either base64 there is. GNU coreutils spells decode `-d` and
 * rejects `-D`; the BSD base64 macOS ships spells it `-D`, and releases before Ventura reject
 * `-d`. There is no flag both accept, so the far side picks: the candidate is tried on an
 * empty input of its own — a pipe from printf — which leaves the heredoc on stdin untouched
 * for whichever invocation wins. No round trip, and nothing here has to know the platform.
 */
const DECODE = "if printf '' | base64 -d >/dev/null 2>&1; then base64 -d; else base64 -D; fi";

interface Pending {
  resolve: (r: ShellResult) => void;
  timer: NodeJS.Timeout;
  onLine: ((line: string) => void) | undefined;
}

class MachineShell {
  #child: ChildProcessWithoutNullStreams | null = null;
  /** What the kind's launch carried for the child up now. */
  #carry: Record<string, unknown> | null = null;
  #buffer = "";
  /** How far into #buffer lines have been handed to the pending command's onLine. */
  #emitted = 0;
  #mark = "";
  #stderr = "";
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idle: NodeJS.Timeout | null = null;
  /** Held: never idles out, reopened when it drops, until close(). */
  #held = false;
  #reopen: NodeJS.Timeout | null = null;
  #backoffMs = RECONNECT_MIN_MS;
  /** Whether the kind has been told the CURRENT child is up; reset when it drops. */
  #upNoticed = false;
  /** The kind's own corner of the session, delivered with it. */
  readonly #memo = new Map<string, unknown>();
  /** Retires this session's registry entry; a no-op once a successor has taken it over. */
  #unregister: (() => void) | null = null;

  constructor(
    readonly address: string,
    /** This generation's handle; a successor that claims the session binds its own. */
    private machine: Machine,
  ) {}

  /** Launches, dials and up-notices go to this handle from now on. */
  bind(machine: Machine): void {
    this.machine = machine;
  }

  /** Keeps the session from here on: a session opened transiently is promoted in place. */
  hold(): void {
    this.#held = true;
    if (this.#idle !== null) clearTimeout(this.#idle);
    this.#idle = null;
    // Delivered across a hot push from now on (module doc): registered under this
    // generation, which retires whatever a predecessor registered for the same address.
    if (registry !== null && this.#unregister === null) {
      this.#unregister = registry.register(sessionResourceId(this.address), this, () =>
        this.close(),
      );
    }
  }

  held(): boolean {
    return this.#held;
  }

  /** What the kind's launch carried for the child up now; null while there is none. */
  carry(): Record<string, unknown> | null {
    return this.#child === null ? null : this.#carry;
  }

  /** The child's own stderr, as far as it has been kept — the diagnosis when it dies, and what a kind reads its warnings off. */
  said(): string {
    return this.#stderr;
  }

  memo(): Map<string, unknown> {
    return this.#memo;
  }

  /**
   * Ends the child now — its kind wants it started again with other arguments. A held session
   * is brought back at once rather than on the backoff: whoever asked is waiting for it.
   */
  async reopen(): Promise<void> {
    if (this.#child === null) return;
    this.#reset();
    if (this.#held) await this.run(":", { timeoutMs: OPEN_TIMEOUT_MS });
  }

  /** Runs one command, opening the session if needed. Never throws; a dead session is a failure. */
  run(command: string, opts: ShellRunOptions = {}): Promise<ShellResult> {
    const next = this.#queue.then(() => this.#runExclusive(command, opts));
    // The queue must survive a rejection, or one failure would stall every later command.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** The session while it is up, or null. */
  session(): ShellSession | null {
    const pid = this.#child?.pid;
    return pid !== undefined ? { pid } : null;
  }

  /** Lets go for good: a held session stops being held, and nothing reopens it. */
  close(): void {
    this.#held = false;
    if (this.#reopen !== null) clearTimeout(this.#reopen);
    this.#reopen = null;
    // Out of the registry means shut down: a session nobody holds is nobody's to deliver.
    // (Identity-checked there: a successor that took this address over is untouched.)
    const unregister = this.#unregister;
    this.#unregister = null;
    this.#reset();
    unregister?.();
  }

  /** Ends the child and answers what was pending. A held session comes back on its own. */
  #reset(): void {
    if (this.#idle !== null) clearTimeout(this.#idle);
    this.#idle = null;
    this.#child?.kill();
    this.#drop();
  }

  /**
   * A held session that is gone is scheduled back. The wait doubles per consecutive failure
   * and is reset by the first command that completes over a live child, so a machine that is
   * down for an hour costs a spawn a minute, and one that blinked is back in a second.
   */
  #scheduleReopen(): void {
    if (this.#reopen !== null) return;
    const wait = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, RECONNECT_MAX_MS);
    this.#reopen = setTimeout(() => {
      this.#reopen = null;
      if (!this.#held || this.#child !== null) return;
      void this.run(":", { timeoutMs: OPEN_TIMEOUT_MS });
    }, wait);
    this.#reopen.unref?.();
  }

  #drop(): void {
    this.#child = null;
    this.#carry = null;
    this.#upNoticed = false;
    this.#buffer = "";
    this.#emitted = 0;
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      // The child's own last words — a refused key, an unknown host — are the diagnosis.
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
    if (this.#held) this.#scheduleReopen();
  }

  async #open(): Promise<ChildProcessWithoutNullStreams> {
    if (this.#child !== null) return this.#child;
    const launch = await this.machine.launch(this);
    this.#mark = `--penguin-${randomBytes(9).toString("hex")}--`;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.program, launch.args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(launch.env === undefined ? {} : { env: { ...process.env, ...launch.env } }),
      });
    } catch (err) {
      throw new Error(
        `could not start ${launch.program}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // setEncoding, not String(chunk): a multibyte character whose bytes land in two `data`
    // events would otherwise decode to two replacement characters. The stream's decoder holds
    // an incomplete sequence back until the rest of it arrives.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#onData(chunk));
    // A write to a session that already died raises EPIPE on this stream ASYNCHRONOUSLY,
    // after the write returned — with no listener that is an unhandled error event, which
    // takes the process down. The command it belonged to is answered by #drop() on exit.
    child.stdin.on("error", () => {});
    // The child's own stderr is not a command's output (those carry theirs on stdout via
    // 2>&1); it is kept for the moment the session dies, when it is the diagnosis. Decoded by
    // the stream for the same reason stdout is: a banner or a remote MOTD is where non-ASCII
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
    child.on("error", (err) => {
      if (this.#child !== child) return;
      // A program that could not be started at all (not installed, not on PATH) says so in
      // the words a person would search for.
      this.#stderr = `${this.#stderr}could not start ${launch.program}: ${err.message}\n`;
      this.#drop();
    });
    this.#child = child;
    this.#carry = launch.carry ?? null;
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
      return { code: 255, output: err instanceof Error ? err.message : String(err) };
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
        this.#reset();
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
      // A command completed over a live child: whatever the last drop cost, the next starts
      // from the shortest wait again.
      if (this.#child !== null) this.#backoffMs = RECONNECT_MIN_MS;
      // And the child is up — the first command through is the proof — so its kind is told,
      // once per child: a drop resets the flag. Not awaited: what the kind does with it (ssh
      // asks its master for the forwards) must not hold up the command that proved it.
      if (this.#child !== null && !this.#upNoticed) {
        this.#upNoticed = true;
        void this.machine.up(this).catch(() => undefined);
      }
      if (this.#held) return;
      this.#idle = setTimeout(() => this.close(), IDLE_MS);
      this.#idle.unref?.();
    });
  }
}

/**
 * The sessions, by machine address. Module-level rather than per App, so ordinary work does
 * not reopen a connection it already has.
 *
 * A hot push re-imports the platform bundle cache-busted (hmr/host.ts), so this map starts
 * empty in the successor — but a HELD session is not lost: it is delivered through the
 * resource registry (module doc) and claimed back by address the first time the successor
 * asks for that machine. The generation on its way out closes only its transient sessions
 * (closeAllShells, from the platform's dispose effect); one never closed that way is
 * collected by its idle timer, which belongs to the process rather than to the module that
 * armed it. Nothing is ever killed by a pid read back from a file: a pid is reused by the
 * OS, and the process at a remembered number may by then be anyone's.
 */
const sessions = new Map<string, MachineShell>();

/**
 * The runtime's resource registry, once the platform hands it over (attachSessionRegistry):
 * where held sessions are delivered across a hot push. Null in a test that never attaches
 * one — every session then belongs to the generation that opened it, as before.
 */
let registry: Resources | null = null;
/** Whether the predecessor's delivered sessions may be claimed at all (hmr/platform.ts decided). */
let adoptDelivered = true;

/**
 * Hands this module the registry, and the platform's verdict on the predecessor's delivered
 * sessions. Called by the machines module at setup — BEFORE it re-holds anything — so a
 * session the previous generation delivered is claimed back rather than opened again
 * beside it; or, when the verdict is no (the contract changed), never claimed: the platform
 * disposes that group at its commit, and this generation opens its own.
 */
export function attachSessionRegistry(resources: Resources | null, adoptable = true): void {
  registry = resources;
  adoptDelivered = adoptable;
}

/**
 * A held session as a successor claims it: the contract between two builds of this file, and
 * what a machine kind is handed (mechanisms/machines.ts) — so a kind reads the session only
 * through what two builds agree on.
 *
 * An INTERFACE, so the generated table (ifaces.json) carries its signatures and everything
 * they reach, and hmr/platform.ts can compare the leaving build's closed shape of it with
 * the booting build's before adopting anything: a member added, removed or retyped — or a
 * type behind one, `Machine` included — dooms the delivered group, and the machines are
 * re-held with objects of the new code. What the shape cannot see is a change of BEHAVIOR
 * behind an unchanged signature; that is what the version in SESSION_GROUP's name is for.
 */
@Interface()
export abstract class MachineSession {
  abstract hold(): void;
  abstract held(): boolean;
  abstract run(command: string, opts?: ShellRunOptions): Promise<ShellResult>;
  abstract session(): ShellSession | null;
  abstract close(): void;
  /** The claiming generation's kind handle: every later launch, dial and up-notice goes to it. */
  abstract bind(machine: Machine): void;
  /** What the kind's launch carried for the child up now; null while there is none. */
  abstract carry(): Record<string, unknown> | null;
  /** The child's stderr as kept so far — the text a kind reads its own warnings off. */
  abstract said(): string;
  /** Ends the child now; a held session is started again at once, with a fresh launch. */
  abstract reopen(): Promise<void>;
  /** The kind's own corner of the session — plain data, delivered with it across a swap. */
  abstract memo(): Map<string, unknown>;
}

/** The delivered contract, by the name the declaration and the adopter use. */
export type HeldSession = MachineSession;

function shellFor(machineAddress: string, machine: Machine): MachineShell {
  let shell = sessions.get(machineAddress);
  if (shell === undefined) {
    // A predecessor's held session first: same address, same child, still up — unless the
    // platform judged the predecessor's contract another one.
    shell =
      (adoptDelivered
        ? registry?.claim<MachineShell>(sessionResourceId(machineAddress))
        : undefined) ?? new MachineShell(machineAddress, machine);
    sessions.set(machineAddress, shell);
    if (shell.held()) shell.hold(); // re-registers under THIS generation (registry ownership)
  }
  // This generation's handle, every time: a claimed session came with the predecessor's, and
  // a definition edited since (a container's) is a new handle for the same address.
  shell.bind(machine);
  return shell;
}

/** Runs a command on a machine over its session. */
export function runOnShell(
  machineAddress: string,
  machine: Machine,
  command: string,
  opts: ShellRunOptions = {},
): Promise<ShellResult> {
  return shellFor(machineAddress, machine).run(command, opts);
}

/**
 * Brings the session up, or reports why it could not be: the first thing a connect does,
 * and what any TCP dial needs. Idempotent — a session already up is answered from memory.
 */
export async function openShell(
  machineAddress: string,
  machine: Machine,
): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
  const shell = shellFor(machineAddress, machine);
  const up = shell.session();
  if (up !== null) return { ok: true, session: up };
  const result = await shell.run(":", { timeoutMs: OPEN_TIMEOUT_MS });
  const session = shell.session();
  if (result.code !== 0 || session === null) {
    return { ok: false, detail: result.output.trim() || "the session did not come up" };
  }
  return { ok: true, session };
}

/**
 * Brings the session up AND keeps it: no idle timer, reopened on its own when it drops, until
 * closeShell. Idempotent, and promotes a session a passing command already opened.
 */
export function holdShell(
  machineAddress: string,
  machine: Machine,
): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
  shellFor(machineAddress, machine).hold();
  return openShell(machineAddress, machine);
}

/** Whether a machine's session is a held one. */
export function isHeld(machineAddress: string): boolean {
  return sessions.get(machineAddress)?.held() ?? false;
}

/**
 * What a platform generation does on its way out: transient sessions closed (they were this
 * generation's), held ones LEFT RUNNING for the successor to claim from the registry — or,
 * with no registry attached, closed like the rest.
 */
export function closeAllShells(): void {
  for (const shell of sessions.values()) {
    if (registry === null || !shell.held()) shell.close();
  }
  sessions.clear();
}

/** A machine's session as its kind is handed it — for a dial, and for a kind's own extension. */
export function shellOf(machineAddress: string, machine: Machine): HeldSession {
  return shellFor(machineAddress, machine);
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
