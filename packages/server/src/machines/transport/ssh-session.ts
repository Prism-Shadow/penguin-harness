/**
 * One long-lived shell per machine, so small commands stop paying for a connection.
 *
 * Every ssh invocation is a TCP connect, a key exchange and an authentication before the
 * command runs, and the commands here are tiny: read a lock file, list a directory. Win32
 * OpenSSH has no ControlMaster, so the multiplexing is done here: `ssh -T <alias> sh` is held
 * open and commands are fed to its stdin — one mechanism on every controller.
 *
 * FRAMING. Each command is wrapped so its end is unambiguous:
 *
 *     ( <command> ) 2>&1 ; printf '\n<mark> %s\n' "$?"
 *
 * A SUBSHELL, so a command containing `exit` cannot end the shell and a `cd` cannot leak. The
 * mark is random per session, so nothing a command prints can forge it. Output and errors are
 * MERGED — separating them over one pipe needs temp files — and that is in the type: the
 * result is `output`, not `stdout`/`stderr`. Commands queue on the one pipe.
 *
 * UNSUPERVISED, like the tunnels: a shell that dies is dropped and the next command opens a
 * new one.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connectionOptionsFor } from "../commands.js";
import type { RemoteTarget } from "../commands.js";

/**
 * What a command in the shared shell produced. `output` is stdout and stderr merged, with
 * the command's own trailing newline kept — the same shape execFile hands back, so a caller
 * parses one channel identically whichever way the command reached the machine.
 */
export interface ShellResult {
  code: number;
  output: string;
}

/** How long an idle shell is kept before it is let go. */
const IDLE_MS = 10 * 60_000;

/** A command that has not finished in this long is treated as a hung shell, not a slow one. */
const COMMAND_TIMEOUT_MS = 60_000;

class MachineShell {
  #child: ChildProcessWithoutNullStreams | null = null;
  #buffer = "";
  #mark = "";
  #pending: { resolve: (r: ShellResult) => void; timer: NodeJS.Timeout } | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idle: NodeJS.Timeout | null = null;

  constructor(private readonly target: RemoteTarget) {}

  /** Runs one command, opening the shell if needed. Never throws; a dead shell is a failure. */
  run(command: string): Promise<ShellResult> {
    const next = this.#queue.then(() => this.#runExclusive(command));
    // The queue must survive a rejection, or one failure would stall every later command.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  close(): void {
    if (this.#idle !== null) clearTimeout(this.#idle);
    this.#idle = null;
    this.#child?.kill();
    this.#drop();
  }

  #drop(): void {
    this.#child = null;
    this.#buffer = "";
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.resolve({ code: 255, output: "the connection to this machine ended" });
    }
  }

  #open(): ChildProcessWithoutNullStreams {
    if (this.#child !== null) return this.#child;
    this.#mark = `--penguin-${randomBytes(9).toString("hex")}--`;
    // `sh` rather than a login shell: this is a command channel, and a profile that prints a
    // banner would land in the first command's output.
    const child = spawn(
      "ssh",
      [...connectionOptionsFor(this.target), "-T", this.target.alias, "sh"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk: Buffer) => this.#onData(String(chunk)));
    // A write to a shell that already died raises EPIPE on this stream ASYNCHRONOUSLY, after
    // the write returned — with no listener that is an unhandled error event, which takes the
    // process down. The command it belonged to is answered by #drop() on the child's own exit,
    // so there is nothing left to report here.
    child.stdin.on("error", () => {});
    // The shell's own stderr (ssh's diagnostics) is not a command's output; merged commands
    // carry theirs on stdout via 2>&1.
    child.stderr.on("data", () => {});
    child.on("exit", () => this.#drop());
    child.on("error", () => this.#drop());
    this.#child = child;
    return child;
  }

  #onData(text: string): void {
    this.#buffer += text;
    const at = this.#buffer.indexOf(this.#mark);
    if (at === -1) return;
    const rest = this.#buffer.slice(at + this.#mark.length);
    const end = rest.indexOf("\n");
    if (end === -1) return; // The exit code has not arrived yet.
    const output = this.#buffer.slice(0, at).replace(/\n$/, "");
    const code = Number.parseInt(rest.slice(0, end).trim(), 10);
    this.#buffer = rest.slice(end + 1);
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.resolve({ code: Number.isFinite(code) ? code : 0, output });
    }
  }

  #runExclusive(command: string): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve) => {
      if (this.#idle !== null) clearTimeout(this.#idle);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.#open();
      } catch {
        resolve({ code: 255, output: "could not start ssh" });
        return;
      }
      const timer = setTimeout(() => {
        // A shell that stopped answering is not one to keep: drop it so the next command
        // opens a fresh connection rather than queueing behind a corpse.
        this.close();
        resolve({ code: 255, output: "the machine did not answer in time" });
      }, COMMAND_TIMEOUT_MS);
      this.#pending = { resolve, timer };
      child.stdin.write(`( ${command} ) 2>&1 ; printf '\\n${this.#mark} %s\\n' "$?"\n`);
    }).finally(() => {
      this.#idle = setTimeout(() => this.close(), IDLE_MS);
      this.#idle.unref?.();
    });
  }
}

/**
 * The shells, by machine address. Module-level rather than per App, so ordinary work does not
 * reopen a connection it already has.
 *
 * A hot push DOES lose them: the platform bundle is re-imported cache-busted (hmr/host.ts),
 * so this map starts empty in the successor and the previous generation's ssh children have
 * nothing holding them. What collects them is the idle timer below — a scheduled timeout
 * belongs to the process, not to the module that scheduled it, so it still fires and still
 * closes the child it was created for. The cost of a push is therefore one reconnect per
 * machine, within IDLE_MS, and never a child nobody ever kills.
 */
const shells = new Map<string, MachineShell>();

/** Runs a small command on a machine over its shared connection. */
export function runOnShell(
  machineAddress: string,
  target: RemoteTarget,
  command: string,
): Promise<ShellResult> {
  let shell = shells.get(machineAddress);
  if (shell === undefined) {
    shell = new MachineShell(target);
    shells.set(machineAddress, shell);
  }
  return shell.run(command);
}

/** Lets go of a machine's connection — for a disconnect, or a machine that went away. */
export function closeShell(machineAddress: string): void {
  shells.get(machineAddress)?.close();
  shells.delete(machineAddress);
}
