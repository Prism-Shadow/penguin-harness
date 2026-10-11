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
 * its wanted set (Machines.setForwards). How the session carries the set is the transport's
 * business (transport/ssh-session.ts): added to the live ssh over its control socket where
 * there is one, in the session's start arguments — reopening it on a change — where there is
 * not (a Windows hub). Either way the set is re-applied whenever the session reconnects, and
 * ssh's answer per forward — a port that would not bind, in ssh's own words — is kept as its
 * fact. Nothing here opens ssh: a saved forward on a machine nobody is using is a wanted set
 * on a session that is down, reported as such, until someone uses the machine again.
 *
 * FACTS, NOT A FLAG. A forward's status names which layer speaks: the session is down, ssh has
 * not been asked yet, ssh said yes, or ssh said no and why.
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
  status: ForwardStatus;
}

export type CreateRefusal =
  | { error: "unknown_machine" }
  | { error: "forward_exists"; existing: PortForwardInfo }
  | { error: "local_port_in_use"; localPort: number }
  | { error: "no_free_local_port" };

/** What the service needs from the machines feature. */
export interface ForwardCarrier {
  knows(machineId: string): boolean;
  setForwards(
    machineId: string,
    specs: readonly ForwardSpec[],
  ): Promise<{ ok: true } | { ok: false; detail: string }>;
  forwardFacts(machineId: string): { connected: boolean; facts: ReadonlyMap<string, ForwardFact> };
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
  constructor(
    private readonly repo: PortForwardsRepo,
    private readonly carrier: ForwardCarrier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hands every machine its wanted set. A machine that is down keeps the set for when it is up. */
  async start(): Promise<void> {
    const machines = new Set(this.repo.all().map((row) => row.machineId));
    for (const machineId of machines) await this.#sync(machineId);
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
    await this.#sync(input.machineId);
    return this.#info(row);
  }

  /** False when there is no such forward. */
  async remove(id: string): Promise<boolean> {
    const row = this.repo.get(id);
    if (row === null) return false;
    this.repo.delete(id);
    await this.#sync(row.machineId);
    return true;
  }

  /** The machine's wanted set, as the record has it, handed to its session. */
  async #sync(machineId: string): Promise<void> {
    const rows = this.repo.all().filter((row) => row.machineId === machineId);
    await this.carrier.setForwards(machineId, rows.map(specOf));
  }

  #info(row: PortForwardRow): PortForwardInfo {
    const { connected, facts } = this.carrier.forwardFacts(row.machineId);
    const fact = facts.get(forwardKey(specOf(row)));
    const status: ForwardStatus = !connected
      ? { kind: "not-connected" }
      : fact === undefined
        ? { kind: "pending" }
        : fact.ok
          ? { kind: "active" }
          : { kind: "failed", detail: fact.detail };
    return { ...row, status };
  }
}
