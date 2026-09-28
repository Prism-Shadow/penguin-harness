/**
 * One mouth per machine, and behind it ONE CONNECTION: every word this server speaks to a
 * machine leaves through the MachineConnection for that machine's address, and everything
 * it carries rides the single shell shell-session.ts holds — a probe as a command on its
 * stdin, an installer or a tarball as a heredoc on the same stdin, the machine's API as a TCP
 * connection its kind dials while that shell is up. Nothing opens a second connection to a
 * machine, however many callers ask and however often, because there is nothing that could.
 *
 * ONE KIND AMONG OTHERS. What reaches the machine is its kind's (mechanisms/machines.ts, a
 * plugin: ssh, WSL, a container): the process the shell is, how a TCP connection gets in, what
 * a failure means. What this file keeps is the part every kind shares: the address, the queue
 * per machine (lane.ts), and the one session. A kind never queues for itself and never
 * judges liveness for itself.
 *
 * The guarantee is AUTHORITY first — nothing outside machines/transport/ opens a connection to
 * a machine, and nothing in packages/server/src starts a machine's program by name at all;
 * machines-transport-boundary.test.ts pins both — and then STRUCTURE: the connection is one,
 * and a second ask queues behind the first. The incident behind this seam (#561) grew where
 * it was absent — four call sites each opened their own channel, each judged the machine's
 * liveness from its own channel's state, and the judgements disagreed.
 *
 * THE ONE EXCEPTION is a machine with no `sh` to hold — a Windows sshd hands commands to
 * cmd.exe. `oneShot` and `copyTo` exist for that host alone, and a machine like that cannot be
 * connected (no session, no dial, no API) until it has a shell to hold. Serialised per
 * machine all the same (lane.ts), and so is `ready`.
 *
 * The handle is stateless on purpose: per-machine state stays in shell-session.ts, keyed by
 * address, so holding a MachineConnection costs nothing and dropping one leaks nothing. The
 * address is `<kind>:<name>` — spelled here (addressOf) and read here (kindOfAddress), and
 * nowhere else.
 *
 * LIFETIME. A session a passing command opened is transient and idles out; one a connect
 * asked to HOLD is kept — reopened by the transport itself when it drops, until a disconnect
 * closes it. A held session outlives a platform generation: it is delivered through the
 * resource registry and claimed back by the next (shell-session.ts); a generation on its way
 * out closes only its transient sessions (closeAllConnections). No session is ever closed by
 * a pid remembered from before.
 */
import http from "node:http";
import type net from "node:net";
import {
  closeAllShells,
  closeShell,
  holdShell,
  isHeld,
  openShell,
  runOnShell,
  sessionOf,
  shellOf,
} from "./shell-session.js";
import type { HeldSession, ShellSession } from "./shell-session.js";
import { inLane } from "./lane.js";
import type { ExecResult, Machine, MachineForwards } from "../../mechanisms/machines.js";

/**
 * A machine as the host addresses it: its kind, its name within the kind, the address both
 * make, and the kind's handle for it. Built by the service from the kinds it was given.
 */
export interface RemoteTarget {
  address: string;
  kind: string;
  name: string;
  machine: Machine;
  /** The installed program's Node over there, as a POSIX shell word (commands.ts remoteNode). */
  node: string;
}

/** The address a machine of `kind` named `name` is known by — the key of every registry in machines/. */
export function addressOf(kind: string, name: string): string {
  return `${kind}:${name}`;
}

/** The kind and the name an address was made of, or null when it is not one. */
export function kindOfAddress(address: string): { kind: string; name: string } | null {
  const at = address.indexOf(":");
  if (at <= 0 || at === address.length - 1) return null;
  return { kind: address.slice(0, at), name: address.slice(at + 1) };
}

/**
 * The verbs a caller speaks to a machine with — what install-server.ts is written against,
 * so a test can hand it a scripted channel instead of a real one.
 */
export interface MachineChannel {
  exec(command: string): Promise<ExecResult>;
  stream(
    command: string,
    opts: { input: Buffer; onLine?: (line: string) => void; timeoutMs?: number },
  ): Promise<ExecResult>;
  oneShot(command: string, opts?: { timeoutMs?: number; input?: Buffer }): Promise<ExecResult>;
  copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult>;
  /** The kind's reading of a failure, in words a person can act on, or null. */
  diagnose(result: ExecResult): string | null;
}

/** Enough for an installer to download a release, or a store to cross a slow link. */
const BULK_TIMEOUT_MS = 10 * 60_000;

export class MachineConnection implements MachineChannel {
  readonly address: string;

  constructor(readonly target: RemoteTarget) {
    this.address = target.address;
  }

  get #machine(): Machine {
    return this.target.machine;
  }

  /** A command over the session — queued, output merged (shell-session.ts), in ExecResult shape. */
  async exec(command: string): Promise<ExecResult> {
    const result = await runOnShell(this.address, this.#machine, command);
    return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
  }

  /**
   * A command that reads `input` from its stdin — an installer script, a tarball — over the
   * same session, as a heredoc. `onLine` relays the far side's progress as it arrives.
   */
  async stream(
    command: string,
    opts: { input: Buffer; onLine?: (line: string) => void; timeoutMs?: number },
  ): Promise<ExecResult> {
    const result = await runOnShell(this.address, this.#machine, command, {
      input: opts.input,
      ...(opts.onLine === undefined ? {} : { onLine: opts.onLine }),
      timeoutMs: opts.timeoutMs ?? BULK_TIMEOUT_MS,
    });
    return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
  }

  /** Brings the session up, or says why it cannot be. Transient: it idles out unused. */
  open(): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
    return openShell(this.address, this.#machine);
  }

  /** Brings the session up and KEEPS it — see the module doc — or says why it cannot be. */
  hold(): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
    return holdShell(this.address, this.#machine);
  }

  /** Whether the session to this machine is a held one. */
  held(): boolean {
    return isHeld(this.address);
  }

  /** The session while it is up. */
  session(): ShellSession | null {
    return sessionOf(this.address);
  }

  /** The session as the kind is handed it (mechanisms/machines.ts). */
  shell(): HeldSession {
    return shellOf(this.address, this.#machine);
  }

  /**
   * Gets the target ready to hold a shell (a container started). Only for what a person asked
   * for — the automatic re-hold never calls it. Serialised per machine.
   */
  ready(): Promise<{ ok: true } | { ok: false; detail: string }> {
    return inLane(this.address, () => this.#machine.ready());
  }

  /** This machine's kind's port forwards, or null when the kind has none. */
  forwards(): MachineForwards | null {
    return this.#machine.forwards();
  }

  /** A TCP connection to `127.0.0.1:<remotePort>` as seen from the machine, dialled by its kind over the session. */
  async dial(remotePort: number): Promise<net.Socket> {
    const opened = await this.open();
    if (!opened.ok) throw new Error(opened.detail);
    return this.#machine.dial(remotePort, { session: this.shell(), node: this.target.node });
  }

  /** An http.Agent whose every socket is a dial through the session — for node:http callers. */
  agent(remotePort: number): http.Agent {
    const agent = new http.Agent({ keepAlive: false });
    // createConnection is documented on Agent (and overridable); the typings omit it.
    (agent as unknown as { createConnection: unknown }).createConnection = (
      _options: unknown,
      callback: (err: Error | null, socket?: net.Socket) => void,
    ) => {
      this.dial(remotePort).then(
        (socket) => callback(null, socket),
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
      );
    };
    return agent;
  }

  /**
   * A MACHINE WITHOUT A SHELL TO HOLD (see the module doc): a command outside the session, with
   * an optional stdin payload. Serialised per machine here — the kind never queues.
   */
  oneShot(command: string, opts: { timeoutMs?: number; input?: Buffer } = {}): Promise<ExecResult> {
    return inLane(this.address, () => this.#machine.oneShot(command, opts));
  }

  /** Local files copied into a directory on the machine, by its kind. Serialised per machine. */
  copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult> {
    return inLane(this.address, () => this.#machine.copyTo(localFiles, remoteDir));
  }

  diagnose(result: ExecResult): string | null {
    return this.#machine.diagnose(result);
  }
}

/** The machine's connection handle. Cheap: state lives in the per-address registry. */
export function connectionTo(target: RemoteTarget): MachineConnection {
  return new MachineConnection(target);
}

/**
 * Lets go of the connection to a machine, held or not. By address rather than on the handle:
 * a disconnect can outlive the resolvability of its target (a kind whose plugin is gone still
 * has a session to close). Only this generation's own registry is consulted — there is
 * deliberately no way to close a session by a pid remembered from before.
 */
export function closeConnectionTo(address: string): void {
  closeShell(address);
}

/** This generation's transient connections closed, its held ones delivered — the platform's dispose effect. */
export function closeAllConnections(): void {
  closeAllShells();
}
