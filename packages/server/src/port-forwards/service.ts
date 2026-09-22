/**
 * Port forwarding: a port on a machine's loopback brought to THIS server's loopback (`in`),
 * or one of ours sent to the machine's (`out`) — ssh's own `-L` and `-R`, on the one session
 * held to the machine.
 *
 * A forward is `(machine, Workspace, direction, remotePort ⇄ localPort)`. It belongs to a
 * Workspace — a directory on a machine — not to a Session: every conversation in that
 * Workspace sees the same list. The record is in web.db (db/repos/port-forwards.ts); what is
 * here is the bookkeeping between the record and the session that carries it.
 *
 * THE SESSION CARRIES IT. Every forward of a machine is handed to that machine's session as
 * its wanted set (Machines.setForwards). The session adds each to the live ssh with
 * `-O forward`, drops it with `-O cancel`, re-applies the set whenever it reconnects, and
 * keeps ssh's answer per forward — a port that would not bind, in ssh's own words. Nothing
 * here opens ssh: a saved forward on a machine nobody is using is a wanted set on a session
 * that is down, reported as such, until someone uses the machine again.
 *
 * WINDOWS HUB. Win32 OpenSSH has no control socket to add a forward to, so on a Windows hub
 * an `in` forward is carried by a listener of this process's own — bound on 127.0.0.1, dialling
 * the machine through the session's SOCKS channel when a client connects — and an `out`
 * forward is refused: nothing here can make the machine listen.
 *
 * FACTS, NOT A FLAG. A forward's status names which layer speaks: the session is down, ssh has
 * not been asked yet, ssh said yes, or ssh said no and why. The listener path adds what it
 * alone can see — connections open and bytes each way.
 */
import net from "node:net";
import { randomBytes } from "node:crypto";
import type { ForwardDirection, ForwardSpec } from "../machines/commands.js";
import { forwardKey } from "../machines/transport/index.js";
import type { ForwardFact } from "../machines/transport/index.js";
import type { PortForwardRow, PortForwardsRepo } from "../db/repos/port-forwards.js";

/** The lowest local port a forward may take: below it a bind needs privileges this server should not have. */
export const MIN_LOCAL_PORT = 1024;
const MAX_PORT = 65535;
/** How far above the asked port the automatic choice looks before giving up. */
const LOCAL_PORT_SEARCH = 200;

export type ForwardStatus =
  | { kind: "active" }
  | { kind: "pending" }
  | { kind: "not-connected" }
  | { kind: "failed"; detail: string };

export interface PortForwardInfo extends PortForwardRow {
  /** Who carries it: ssh on the session, or a listener of this process's own (Windows hub). */
  via: "ssh" | "listener";
  status: ForwardStatus;
  /** What only the listener path can count. */
  traffic?: { open: number; bytesUp: number; bytesDown: number };
}

export type CreateRefusal =
  | { error: "unknown_machine" }
  | { error: "forward_exists"; existing: PortForwardInfo }
  | { error: "local_port_in_use"; localPort: number }
  | { error: "no_free_local_port" }
  /** An `out` forward on a hub whose ssh cannot carry one. */
  | { error: "unsupported_here" };

/** What the service needs from the machines feature. */
export interface ForwardCarrier {
  knows(machineId: string): boolean;
  setForwards(
    machineId: string,
    specs: readonly ForwardSpec[],
  ): Promise<{ ok: true; supported: boolean } | { ok: false; detail: string }>;
  forwardFacts(machineId: string): { connected: boolean; facts: ReadonlyMap<string, ForwardFact> };
  dialPort(
    machineId: string,
    remotePort: number,
  ): Promise<{ ok: true; socket: net.Socket } | { ok: false; detail: string }>;
}

/** A listener of this process's own — the Windows hub's way of carrying an `in` forward. */
interface Live {
  server: net.Server | null;
  listener: { listening: true } | { error: string };
  dial: { answeredAt: string } | { failedAt: string; detail: string } | null;
  sockets: Set<net.Socket>;
  bytesUp: number;
  bytesDown: number;
}

export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PORT;
}

export function isDirection(value: unknown): value is ForwardDirection {
  return value === "in" || value === "out";
}

const specOf = (row: PortForwardRow): ForwardSpec => ({
  direction: row.direction,
  localPort: row.localPort,
  remotePort: row.remotePort,
});

/** Whether `127.0.0.1:<port>` can be bound here right now. */
function bindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      probe.close(() => resolve(true)),
    );
  });
}

export class PortForwardService {
  /** Machines whose session cannot carry forwards: their `in` forwards live here instead. */
  readonly #live = new Map<string, Live>();
  readonly #unsupported = new Set<string>();

  constructor(
    private readonly repo: PortForwardsRepo,
    private readonly carrier: ForwardCarrier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hands every machine its wanted set. A machine that is down keeps the set for when it is up. */
  async start(): Promise<void> {
    const byMachine = new Map<string, PortForwardRow[]>();
    for (const row of this.repo.all()) {
      const rows = byMachine.get(row.machineId);
      if (rows === undefined) byMachine.set(row.machineId, [row]);
      else rows.push(row);
    }
    for (const machineId of byMachine.keys()) await this.#sync(machineId);
  }

  /** Closes this process's own listeners. The records — and the sessions' wanted sets — stay. */
  stop(): void {
    for (const id of [...this.#live.keys()]) this.#close(id);
  }

  list(filter: { machineId?: string; workspace?: string } = {}): PortForwardInfo[] {
    return this.repo
      .all()
      .filter(
        (row) =>
          (filter.machineId === undefined || row.machineId === filter.machineId) &&
          (filter.workspace === undefined || row.workspace === filter.workspace),
      )
      .map((row) => this.#info(row));
  }

  async create(input: {
    machineId: string;
    workspace: string;
    direction: ForwardDirection;
    remotePort: number;
    localPort?: number;
  }): Promise<PortForwardInfo | CreateRefusal> {
    if (!this.carrier.knows(input.machineId)) return { error: "unknown_machine" };
    const existing = this.repo.find(
      input.machineId,
      input.workspace,
      input.direction,
      input.remotePort,
    );
    if (existing !== null) return { error: "forward_exists", existing: this.#info(existing) };
    if (input.direction === "out" && this.#unsupported.has(input.machineId)) {
      return { error: "unsupported_here" };
    }

    // The local port. Asked for: taken or refused. Automatic: the remote port's own number —
    // the address a person would guess — or the first above it that is free here. An `out`
    // forward's local port is the service being sent, which is the caller's to name.
    let localPort = input.localPort;
    if (localPort === undefined) {
      const first = Math.max(input.remotePort, MIN_LOCAL_PORT);
      for (let port = first; port <= Math.min(first + LOCAL_PORT_SEARCH, MAX_PORT); port++) {
        if (this.repo.byLocalPort(port) !== null) continue;
        if (input.direction === "in" && !(await bindable(port))) continue;
        localPort = port;
        break;
      }
      if (localPort === undefined) return { error: "no_free_local_port" };
    } else if (input.direction === "in") {
      if (this.repo.byLocalPort(localPort) !== null || !(await bindable(localPort))) {
        return { error: "local_port_in_use", localPort };
      }
    }

    const row: PortForwardRow = {
      id: randomBytes(9).toString("base64url"),
      machineId: input.machineId,
      workspace: input.workspace,
      direction: input.direction,
      remotePort: input.remotePort,
      localPort,
      createdAt: this.now().toISOString(),
    };
    this.repo.insert(row);
    const synced = await this.#sync(input.machineId);
    // A hub that cannot carry an `out` forward learned so only now, on its first machine.
    if (!synced && input.direction === "out") {
      this.repo.delete(row.id);
      return { error: "unsupported_here" };
    }
    return this.#info(row);
  }

  /** False when there is no such forward. */
  async remove(id: string): Promise<boolean> {
    const row = this.repo.get(id);
    if (row === null) return false;
    this.repo.delete(id);
    this.#close(id);
    await this.#sync(row.machineId);
    return true;
  }

  /**
   * The machine's wanted set, as the record has it, handed to its session. On a hub whose ssh
   * cannot carry forwards the `in` ones are bound here instead. Answers whether ssh carries
   * them.
   */
  async #sync(machineId: string): Promise<boolean> {
    const rows = this.repo.all().filter((row) => row.machineId === machineId);
    const result = await this.carrier.setForwards(machineId, rows.map(specOf));
    const supported = result.ok && result.supported;
    if (supported) {
      this.#unsupported.delete(machineId);
      return true;
    }
    this.#unsupported.add(machineId);
    for (const row of rows) {
      if (row.direction === "in" && !this.#live.has(row.id)) await this.#listen(row);
    }
    return false;
  }

  #info(row: PortForwardRow): PortForwardInfo {
    const live = this.#live.get(row.id);
    if (live !== undefined) {
      const status: ForwardStatus =
        "error" in live.listener
          ? { kind: "failed", detail: live.listener.error }
          : live.dial !== null && "failedAt" in live.dial
            ? { kind: "failed", detail: live.dial.detail }
            : { kind: "active" };
      return {
        ...row,
        via: "listener",
        status,
        traffic: { open: live.sockets.size, bytesUp: live.bytesUp, bytesDown: live.bytesDown },
      };
    }
    if (this.#unsupported.has(row.machineId)) {
      return { ...row, via: "ssh", status: { kind: "failed", detail: "not carried on this hub" } };
    }
    const { connected, facts } = this.carrier.forwardFacts(row.machineId);
    const fact = facts.get(forwardKey(specOf(row)));
    const status: ForwardStatus = !connected
      ? { kind: "not-connected" }
      : fact === undefined
        ? { kind: "pending" }
        : fact.ok
          ? { kind: "active" }
          : { kind: "failed", detail: fact.detail };
    return { ...row, via: "ssh", status };
  }

  // --- the listener path (Windows hub) ------------------------------------------------------

  #listen(row: PortForwardRow): Promise<void> {
    const live: Live = {
      server: null,
      listener: { error: "not started" },
      dial: null,
      sockets: new Set(),
      bytesUp: 0,
      bytesDown: 0,
    };
    this.#live.set(row.id, live);
    // Half-open on purpose: a client that has finished SENDING (a request piped through
    // `nc`, an HTTP/1.0 exchange) still has its answer coming. Without it the FIN would end
    // the socket both ways and the reply would be cut off; the pipes below pass each end on.
    const server = net.createServer(
      { allowHalfOpen: true },
      (client) => void this.#pipe(row, live, client),
    );
    live.server = server;
    return new Promise((resolve) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        live.listener = { error: err.code ?? err.message };
        live.server = null;
        resolve();
      });
      server.listen({ host: "127.0.0.1", port: row.localPort, exclusive: true }, () => {
        live.listener = { listening: true };
        // Later errors are the listener's too (EMFILE under load): a fact, never a crash.
        server.on("error", (err: NodeJS.ErrnoException) => {
          live.listener = { error: err.code ?? err.message };
        });
        resolve();
      });
    });
  }

  async #pipe(row: PortForwardRow, live: Live, client: net.Socket): Promise<void> {
    live.sockets.add(client);
    client.on("close", () => live.sockets.delete(client));
    // A client that resets while the dial is in flight must not take the process with it.
    client.on("error", () => client.destroy());
    // Nothing is read until there is somewhere to write it: what the client sends during
    // the dial stays in the kernel's buffer instead of this process's.
    client.pause();

    const dialled = await this.carrier.dialPort(row.machineId, row.remotePort);
    if (!dialled.ok) {
      live.dial = { failedAt: this.now().toISOString(), detail: dialled.detail };
      client.destroy();
      return;
    }
    const remote = dialled.socket;
    live.dial = { answeredAt: this.now().toISOString() };
    if (client.destroyed) {
      remote.destroy();
      return;
    }
    live.sockets.add(remote);
    remote.on("close", () => {
      live.sockets.delete(remote);
      client.destroy();
    });
    remote.on("error", () => remote.destroy());
    client.on("close", () => remote.destroy());
    client.on("data", (chunk: Buffer) => (live.bytesUp += chunk.length));
    remote.on("data", (chunk: Buffer) => (live.bytesDown += chunk.length));
    client.pipe(remote);
    remote.pipe(client);
  }

  #close(id: string): void {
    const live = this.#live.get(id);
    if (live === undefined) return;
    this.#live.delete(id);
    live.server?.close();
    for (const socket of live.sockets) socket.destroy();
  }
}
