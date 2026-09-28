/**
 * The machine mechanisms: what a machine KIND contributes, declared apart from what hosts it.
 *
 * A kind — ssh, WSL, a container — is a plugin. It contributes to `MachinesModule.kinds` (the
 * slot in machines/service.ts): the data half in its manifest (`{ kind, title }`, the kind's
 * name being the address prefix every machine of it is known by), the code half a
 * `MachineKind`. What a kind differs in is only what it can differ in: where its targets come
 * from, which process it starts to reach one, how a TCP connection to the machine is dialled,
 * where a machine's definition is stored, what its failures mean.
 *
 * What it does NOT get is the connection. "One machine, one connection" is the host's
 * (machines/transport/): the framing, the per-address registry, the queue, the two lifetimes,
 * the liveness bookkeeping are the same bytes for every kind, and a copy per plugin would
 * grow back the incident behind that seam (#561) — N channels each judging the machine's
 * liveness from its own state. So a kind hands over DESCRIPTIONS and never calls the host:
 * `launch()` says what to spawn, and the host spawns it. It could not call the host anyway: a
 * contributor is created before the module it contributes to, so a kind that `@Use()`d
 * anything MachinesModule provides would be a cycle.
 *
 * Every signature here is a contract a plugin compiles against
 * (`@prismshadow/penguin-server/plugin`, types only). It is checked by the plugin's own `tsc`,
 * not at load: iface-check compares requires and provides, never a slot's code half — the
 * same standing the sandbox providers and messaging connectors have.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type net from "node:net";
import type { MachineForm } from "../api/types.js";
import type { MachineSession } from "../machines/transport/index.js";

export type {
  MachineSession,
  ShellResult,
  ShellRunOptions,
  ShellSession,
} from "../machines/transport/index.js";
export type { MachineForm } from "../api/types.js";

/**
 * What a command run on a machine left behind. Failures are returned, never thrown, and carry
 * the far side's words verbatim — a refused key or an unknown host is the person's to read.
 */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  /**
   * True when the command was killed for running past its budget. Worth its own flag because
   * a timeout is otherwise INDISTINGUISHABLE from a refusal: the child is killed before it
   * says anything, so the result is a non-zero code with empty stderr — which reads as "the
   * remote said no" when the truth is "the remote never answered in time".
   */
  timedOut: boolean;
}

/**
 * How the host starts the one shell it holds to a machine. The process's stdin must be a
 * POSIX `sh` ON THE MACHINE: the host frames every command it writes there the same way for
 * every kind.
 */
export interface ShellLaunch {
  program: string;
  args: string[];
  /** Added to this process's environment for the child (WSL wants `WSL_UTF8=1`). */
  env?: Record<string, string>;
  /**
   * What the kind must remember of THIS child — ssh's SOCKS port and control socket, and the
   * forwards its argv carries. Plain data. The host keeps it with the session, hands it back
   * through `MachineSession.carry()`, and forgets it when the child is gone.
   */
  carry?: Record<string, unknown>;
}

/** Which way a port forward carries bytes: `in` brings a machine's port here, `out` sends one of ours there. */
export type ForwardDirection = "in" | "out";

export interface ForwardSpec {
  direction: ForwardDirection;
  /** The port on this server's loopback. */
  localPort: number;
  /** The port on the machine's loopback. */
  remotePort: number;
}

/** What the kind answered when a forward was last asked for. */
export type ForwardFact = { ok: true } | { ok: false; detail: string };

/**
 * Port forwards on a machine's session: a kind's OWN extension, not the host's. ssh has one
 * (its `-L`/`-R`, over a control socket or in its start arguments); a kind without one says so
 * by answering null from `Machine.forwards()` — the host then reports every wanted forward of
 * that machine as refused, in words, rather than pretending to carry it.
 *
 * Whatever the kind keeps between calls lives in `session.memo()`, the kind's corner of the
 * session: it is delivered with the session across a hot push, where module state is not.
 */
@Interface()
export abstract class MachineForwards {
  /** The forwards wanted on this machine's session from now on; applied at once when it is up. */
  abstract set(session: MachineSession, specs: readonly ForwardSpec[]): Promise<void>;
  /** The kind's last word on each wanted forward, for the child up now; empty until asked. */
  abstract facts(session: MachineSession): { spec: ForwardSpec; fact: ForwardFact }[];
}

/** Where a dial rides: the session the host holds, and the machine's own Node for a kind that bridges. */
export interface MachineDial {
  session: MachineSession;
  /**
   * The Node the installed program carries on that machine, as a POSIX shell word (it may name
   * `$HOME`, so it is meant for an `sh -c`). A kind without a TCP path of its own — WSL, a
   * container — runs a one-line bridge with it; ssh has its SOCKS port and ignores it.
   */
  node: string;
}

/** One machine of a kind: stateless, so holding one costs nothing and dropping one leaks nothing. */
@Interface()
export abstract class Machine {
  /**
   * The shell to hold, asked each time the host (re)opens the session. `session` is the one it
   * will belong to — a kind reads its own memo there (ssh: the forwards to start with).
   */
  abstract launch(session: MachineSession): Promise<ShellLaunch>;
  /**
   * Told once per child, after the first command came back over it: the session is up. ssh asks
   * its master for the wanted forwards here; a kind with nothing to do answers at once.
   */
  abstract up(session: MachineSession): Promise<void>;
  /**
   * Gets the target into a state where a shell can be held — a container created or started.
   * Called only for what a PERSON asked (an install, a connect), never by the automatic
   * re-hold: a sweep does not bring a stopped container back on its own.
   */
  abstract ready(): Promise<{ ok: true } | { ok: false; detail: string }>;
  /** A TCP connection to `127.0.0.1:<port>` as the machine sees it, while the session is up. */
  abstract dial(port: number, via: MachineDial): Promise<Opaque<"Socket", net.Socket>>;
  /**
   * A command outside the held shell, with an optional stdin payload — for a machine that has
   * no `sh` to hold (a Windows sshd hands commands to cmd.exe). Serialised per machine by the
   * host, never by the kind.
   */
  abstract oneShot(
    command: string,
    opts: { timeoutMs?: number; input?: Opaque<"Buffer", Buffer> },
  ): Promise<ExecResult>;
  /** Local files copied into a directory on the machine. Serialised per machine by the host. */
  abstract copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult>;
  /** What a failure means in words a person can act on (ssh: set up key authentication), or null. */
  abstract diagnose(result: ExecResult): string | null;
  /** This kind's port forwards, or null: this kind has none. */
  abstract forwards(): MachineForwards | null;
}

/**
 * A definition checked. `spec` non-null means the HOST stores it (machine_definitions) and
 * hands it back to `read` and `connect`; null means the kind stored it itself (ssh wrote its
 * Host block). A refusal names the field it is about, or null for the definition as a whole.
 */
export type MachineDefinition =
  | { ok: true; spec: Record<string, unknown> | null }
  | { ok: false; field: string | null; message: string };

/** A machine of a kind: where its targets come from, and how one is reached. */
@Interface()
export abstract class MachineKind {
  /**
   * The targets reachable right now without a person defining them — ssh's config aliases,
   * WSL's distros; none for a container. Synchronous and cheap (no process, no network): the
   * list calls it on every read. A kind that has to ask a program caches in the background.
   */
  abstract discover(): string[];
  /** The form to define one by hand, or null: this kind is not defined by hand. */
  abstract form(): MachineForm | null;
  /** Checks — and for a kind that stores its own, writes — a definition. `existing`: an edit. */
  abstract define(
    name: string,
    values: Record<string, unknown>,
    existing: boolean,
  ): Promise<MachineDefinition>;
  /** A definition read back for the form, and whether it may be rewritten; null when there is none. */
  abstract read(
    name: string,
    spec: Record<string, unknown> | null,
  ): { values: Record<string, unknown>; editable: boolean } | null;
  /** The machine by that name. `spec` is what the host stored for it, or null. */
  abstract connect(name: string, spec: Record<string, unknown> | null): Machine;
}
