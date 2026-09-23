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
 *
 * AN `out` FORWARD IS CLEARED FIRST. Its listener is on the machine, and the machine's sshd
 * decides where that listener binds (commands.ts ForwardExposure): a sshd that widens the
 * loopback bind to every interface makes the forward an open door on that machine's network.
 * So before an `out` forward is ever handed to a session, the machine is asked — one probe
 * connection, cached — and the forward is carried only when the answer is `loopback`, or when
 * an admin consented to that machine under Settings > Ports (exposure.ts). `exposes` and
 * `unknown` alike are refused: a machine that cannot be read is not assumed safe. A refused
 * forward stays on record and reads `exposure-refused`; consent hands it over.
 */
import net from "node:net";
import { randomBytes } from "node:crypto";
import type { ForwardDirection, ForwardExposure, ForwardSpec } from "../machines/commands.js";
import { forwardKey } from "../machines/transport/index.js";
import type { ForwardFact } from "../machines/transport/index.js";
import type { PortForwardRow, PortForwardsRepo } from "../db/repos/port-forwards.js";
import type { ExposureConsent } from "./exposure.js";

/** The lowest local port a forward may take: below it a bind needs privileges this server should not have. */
export const MIN_LOCAL_PORT = 1024;
const MAX_PORT = 65535;
/** How far above the asked port the automatic choice looks before giving up. */
const LOCAL_PORT_SEARCH = 200;

/**
 * How long a definite exposure verdict stands before the machine is asked again. sshd's
 * configuration changes rarely; the probe is a whole connection. `unknown` is never kept:
 * a machine that was down answers differently the moment it is up.
 */
const EXPOSURE_TTL_MS = 10 * 60_000;
/** How often a read may retry the hand-over of forwards withheld for lack of a verdict. */
const WITHHELD_RETRY_MS = 30_000;

/** Why an `out` forward is not carried: the machine's sshd widens the bind, or could not be read. */
export type ExposureRefusal = "exposes" | "unknown";

export type ForwardStatus =
  | { kind: "active" }
  | { kind: "pending" }
  | { kind: "not-connected" }
  | { kind: "failed"; detail: string }
  | { kind: "exposure-refused"; mode: ExposureRefusal };

export interface PortForwardInfo extends PortForwardRow {
  status: ForwardStatus;
}

export type CreateRefusal =
  | { error: "unknown_machine" }
  | { error: "forward_exists"; existing: PortForwardInfo }
  | { error: "local_port_in_use"; localPort: number }
  | { error: "no_free_local_port" }
  | { error: "exposure_refused"; mode: ExposureRefusal };

/** A machine as the Ports settings page lists it: its consent, and the last verdict if any. */
export interface MachineExposure {
  machineId: string;
  alias: string;
  allowed: boolean;
  exposure: ForwardExposure | null;
}

/** What the service needs from the machines feature. */
export interface ForwardCarrier {
  knows(machineId: string): boolean;
  known(): { machineId: string; alias: string }[];
  setForwards(
    machineId: string,
    specs: readonly ForwardSpec[],
  ): Promise<{ ok: true } | { ok: false; detail: string }>;
  forwardFacts(machineId: string): { connected: boolean; facts: ReadonlyMap<string, ForwardFact> };
  forwardExposure(machineId: string): Promise<ForwardExposure>;
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
  /** The last definite verdict per machine, and when it was found out. */
  readonly #exposure = new Map<string, { at: number; exposure: ForwardExposure }>();
  /** Machines whose `out` forwards are on record but not handed over, with why, and when last tried. */
  readonly #withheld = new Map<string, { mode: ExposureRefusal; at: number }>();
  /** One probe per machine at a time: a second ask waits for the first. */
  readonly #probing = new Map<string, Promise<ForwardExposure>>();

  constructor(
    private readonly repo: PortForwardsRepo,
    private readonly carrier: ForwardCarrier,
    private readonly consent: ExposureConsent,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hands every machine its wanted set. A machine that is down keeps the set for when it is up. */
  async start(): Promise<void> {
    const machines = new Set(this.repo.all().map((row) => row.machineId));
    for (const machineId of machines) await this.#sync(machineId);
  }

  list(filter: { machineId?: string; workspace?: string } = {}): PortForwardInfo[] {
    // A withheld machine whose verdict was `unknown` is tried again from here, at most every
    // WITHHELD_RETRY_MS: nothing else would — a machine that was down at boot comes up on
    // its own, and the page polling this is the one place that keeps looking.
    for (const [machineId, held] of this.#withheld) {
      if (held.mode !== "unknown" || held.at + WITHHELD_RETRY_MS > this.now().getTime()) continue;
      if (!this.carrier.forwardFacts(machineId).connected) continue;
      held.at = this.now().getTime();
      void this.#sync(machineId);
    }
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
    if (input.direction === "out") {
      const cleared = await this.#cleared(input.machineId);
      if (!cleared.ok) return { error: "exposure_refused", mode: cleared.mode };
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

  /** The machines an admin may consent for, each with its consent and last verdict. */
  exposure(): MachineExposure[] {
    return this.carrier.known().map(({ machineId, alias }) => ({
      machineId,
      alias,
      allowed: this.consent.allowed(machineId),
      exposure: this.#exposure.get(machineId)?.exposure ?? null,
    }));
  }

  /** Records the consent and hands the machine its set again under it. Null: no such machine. */
  async setAllowed(machineId: string, allowed: boolean): Promise<MachineExposure | null> {
    if (!this.carrier.knows(machineId)) return null;
    this.consent.setAllowed(machineId, allowed);
    await this.#sync(machineId);
    return this.exposure().find((m) => m.machineId === machineId) ?? null;
  }

  /** Asks the machine afresh — the settings page's own button — and re-evaluates its forwards. Null: no such machine. */
  async probe(machineId: string): Promise<MachineExposure | null> {
    if (!this.carrier.knows(machineId)) return null;
    this.#exposure.delete(machineId);
    await this.#exposureOf(machineId);
    await this.#sync(machineId);
    return this.exposure().find((m) => m.machineId === machineId) ?? null;
  }

  /** The machine's verdict: the cached one while it stands, else asked now — once at a time. */
  async #exposureOf(machineId: string): Promise<ForwardExposure> {
    const cached = this.#exposure.get(machineId);
    if (cached !== undefined && cached.at + EXPOSURE_TTL_MS > this.now().getTime()) {
      return cached.exposure;
    }
    let pending = this.#probing.get(machineId);
    if (pending === undefined) {
      pending = this.carrier.forwardExposure(machineId).finally(() => {
        this.#probing.delete(machineId);
      });
      this.#probing.set(machineId, pending);
    }
    const exposure = await pending;
    if (exposure.mode !== "unknown") {
      this.#exposure.set(machineId, { at: this.now().getTime(), exposure });
    }
    return exposure;
  }

  /** Whether `out` forwards may go to this machine: consented, or its sshd keeps them on the loopback. */
  async #cleared(machineId: string): Promise<{ ok: true } | { ok: false; mode: ExposureRefusal }> {
    if (this.consent.allowed(machineId)) return { ok: true };
    const exposure = await this.#exposureOf(machineId);
    return exposure.mode === "loopback" ? { ok: true } : { ok: false, mode: exposure.mode };
  }

  /**
   * The machine's wanted set, as the record has it, handed to its session — its `out` rows
   * only once the machine is cleared for them; withheld otherwise, and said so.
   */
  async #sync(machineId: string): Promise<void> {
    const rows = this.repo.all().filter((row) => row.machineId === machineId);
    let wanted = rows;
    if (rows.some((row) => row.direction === "out")) {
      const cleared = await this.#cleared(machineId);
      if (cleared.ok) this.#withheld.delete(machineId);
      else {
        this.#withheld.set(machineId, { mode: cleared.mode, at: this.now().getTime() });
        wanted = rows.filter((row) => row.direction === "in");
      }
    } else {
      this.#withheld.delete(machineId);
    }
    await this.carrier.setForwards(machineId, wanted.map(specOf));
  }

  #info(row: PortForwardRow): PortForwardInfo {
    const withheld = this.#withheld.get(row.machineId);
    if (row.direction === "out" && withheld !== undefined) {
      return { ...row, status: { kind: "exposure-refused", mode: withheld.mode } };
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
    return { ...row, status };
  }
}
