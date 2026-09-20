/**
 * Port forwarding: a TCP port on a machine's loopback, brought to THIS server's loopback.
 *
 * One forward is `(machine, Workspace, remotePort) → localPort`. It belongs to a Workspace —
 * a directory on a machine — not to a Session: every conversation in that Workspace sees the
 * same list. The record is in web.db (db/repos/port-forwards.ts); what is here is the part
 * that lives: one listener per record on `127.0.0.1:<localPort>`, and the bytes through it.
 *
 * THE LISTENER IS CHEAP AND LOCAL, THE DIAL IS NOT. A listener binds when its record is made
 * and when a platform generation starts, and costs nothing until someone connects. Only then
 * is a channel dialled to the machine — through the one connection held to it
 * (Machines.dialPort), never through one of its own. A forward does not open ssh: with the
 * machine not connected the client is closed at once and the reason is kept, so a saved
 * forward cannot quietly reconnect a machine someone stopped using.
 *
 * LOOPBACK ONLY. The listener binds 127.0.0.1 and nothing else: a forward hands whoever can
 * reach it a port of another computer, and "whoever can reach it" has to stay "this machine".
 *
 * FACTS, NOT A FLAG. What is known of a forward is reported by layer, each with its moment:
 * whether the listener is up, what the last dial came to, how many connections are open and
 * how many bytes went each way. Nothing folds them into one "working" boolean — a listener
 * that is up says nothing about the machine behind it, and the page debugging a dead port
 * needs to see which layer is the dead one.
 */
import net from "node:net";
import { randomBytes } from "node:crypto";
import type { PortForwardRow, PortForwardsRepo } from "../db/repos/port-forwards.js";

/** The lowest local port a forward may take: below it a bind needs privileges this server should not have. */
export const MIN_LOCAL_PORT = 1024;
const MAX_PORT = 65535;
/** How far above the asked port the automatic choice looks before giving up. */
const LOCAL_PORT_SEARCH = 200;

export type ListenerFact = { listening: true } | { error: string };
export type DialFact = { answeredAt: string } | { failedAt: string; detail: string };

export interface PortForwardInfo extends PortForwardRow {
  listener: ListenerFact;
  /** The last dial to the machine; null until a client has connected. */
  dial: DialFact | null;
  /** Connections open right now. */
  open: number;
  /** Bytes from local clients to the machine, and back, since this process started. */
  bytesUp: number;
  bytesDown: number;
}

export type CreateRefusal =
  | { error: "unknown_machine" }
  | { error: "forward_exists"; existing: PortForwardInfo }
  | { error: "local_port_in_use"; localPort: number }
  | { error: "no_free_local_port" };

/** What the service needs from the machines feature: whether an id is known, and a channel to a port. */
export interface ForwardDialer {
  knows(machineId: string): boolean;
  dialPort(
    machineId: string,
    remotePort: number,
  ): Promise<{ ok: true; socket: net.Socket } | { ok: false; detail: string }>;
}

interface Live {
  server: net.Server | null;
  listener: ListenerFact;
  dial: DialFact | null;
  sockets: Set<net.Socket>;
  bytesUp: number;
  bytesDown: number;
}

export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PORT;
}

export class PortForwardService {
  readonly #live = new Map<string, Live>();

  constructor(
    private readonly repo: PortForwardsRepo,
    private readonly dialer: ForwardDialer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Binds a listener for every saved forward. A port that will not bind is a fact of that forward, not a failure of the start. */
  async start(): Promise<void> {
    await Promise.all(this.repo.all().map((row) => this.#listen(row)));
  }

  /** Closes every listener and every connection through them. The records stay. */
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
    remotePort: number;
    localPort?: number;
  }): Promise<PortForwardInfo | CreateRefusal> {
    if (!this.dialer.knows(input.machineId)) return { error: "unknown_machine" };
    const existing = this.repo.find(input.machineId, input.workspace, input.remotePort);
    if (existing !== null) return { error: "forward_exists", existing: this.#info(existing) };

    // An asked-for port is taken or refused; an automatic one starts at the remote port —
    // the address a person would guess — and walks up to the first that binds.
    const asked = input.localPort;
    const first = asked ?? Math.max(input.remotePort, MIN_LOCAL_PORT);
    const last = asked ?? Math.min(first + LOCAL_PORT_SEARCH, MAX_PORT);
    for (let localPort = first; localPort <= last; localPort++) {
      if (this.repo.byLocalPort(localPort) !== null) continue;
      const row: PortForwardRow = {
        id: randomBytes(9).toString("base64url"),
        machineId: input.machineId,
        workspace: input.workspace,
        remotePort: input.remotePort,
        localPort,
        createdAt: this.now().toISOString(),
      };
      // Bound BEFORE it is recorded: a record whose port never bound would be a forward that
      // has not worked for a single moment of its life.
      await this.#listen(row);
      if ("listening" in this.#live.get(row.id)!.listener) {
        this.repo.insert(row);
        return this.#info(row);
      }
      this.#close(row.id);
    }
    return asked === undefined
      ? { error: "no_free_local_port" }
      : { error: "local_port_in_use", localPort: asked };
  }

  /** False when there is no such forward. */
  remove(id: string): boolean {
    if (this.repo.get(id) === null) return false;
    this.#close(id);
    this.repo.delete(id);
    return true;
  }

  #info(row: PortForwardRow): PortForwardInfo {
    const live = this.#live.get(row.id);
    return {
      ...row,
      listener: live?.listener ?? { error: "not started" },
      dial: live?.dial ?? null,
      open: live?.sockets.size ?? 0,
      bytesUp: live?.bytesUp ?? 0,
      bytesDown: live?.bytesDown ?? 0,
    };
  }

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

    const dialled = await this.dialer.dialPort(row.machineId, row.remotePort);
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
