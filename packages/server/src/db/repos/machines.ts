/**
 * What this server remembers about machines: its own identity, the tunnel it holds to each
 * machine, which machines each Project uses, and the Model config last handed to each.
 *
 * In web.db rather than in files beside it. A hot swap or a restart reads back exactly what
 * the last generation wrote, with no parser per file and no partial write to guard against.
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

/** The tunnel this server holds to a machine, as the connect flow records it. */
export interface ConnectState {
  /** Local (= remote) port the tunnel forwards. */
  port: number;
  /** That machine's own id, once heard. */
  machineId?: string;
  /** The ssh child holding the tunnel, while one is believed alive. */
  tunnelPid?: number;
  connectedAt?: string;
}

/**
 * 12 random bytes as base64url: 16 characters a person can read in a tooltip, 96 bits
 * against ids minted on machines that never coordinate.
 */
const MACHINE_ID_BYTES = 12;

export class MachinesRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * This server's own id if one has been minted, without minting one — `penguin server
   * status` runs on a data root whose server may never have started, and must not create an
   * identity as a side effect of the question.
   */
  peekOwnId(): string | null {
    const row = this.db.prepare("SELECT machine_id FROM machine WHERE singleton = 1").get();
    return row ? (row.machine_id as string) : null;
  }

  /** This server's own id, minted on first call and stable ever after. */
  ownId(): string {
    const existing = this.peekOwnId();
    if (existing !== null) return existing;
    const minted = randomBytes(MACHINE_ID_BYTES).toString("base64url");
    this.db.prepare("INSERT INTO machine (singleton, machine_id) VALUES (1, ?)").run(minted);
    return minted;
  }

  connect(address: string): ConnectState | null {
    const row = this.db.prepare("SELECT * FROM machine_connect WHERE address = ?").get(address) as
      Record<string, unknown> | undefined;
    return row === undefined ? null : toConnect(row);
  }

  connects(): Record<string, ConnectState> {
    const out: Record<string, ConnectState> = {};
    for (const row of this.db.prepare("SELECT * FROM machine_connect").all()) {
      out[row.address as string] = toConnect(row as Record<string, unknown>);
    }
    return out;
  }

  setConnect(address: string, state: ConnectState | null): void {
    if (state === null) {
      this.db.prepare("DELETE FROM machine_connect WHERE address = ?").run(address);
      return;
    }
    this.db
      .prepare(
        "INSERT OR REPLACE INTO machine_connect (address, port, machine_id, tunnel_pid, connected_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        address,
        state.port,
        state.machineId ?? null,
        state.tunnelPid ?? null,
        state.connectedAt ?? null,
      );
  }

  /** The addresses a Project uses, or null when it has never had a list written for it. */
  members(projectId: string): string[] | null {
    const row = this.db
      .prepare("SELECT addresses FROM machine_project WHERE project_id = ?")
      .get(projectId);
    return row ? (JSON.parse(row.addresses as string) as string[]) : null;
  }

  setMembers(projectId: string, addresses: string[]): void {
    this.db
      .prepare("INSERT OR REPLACE INTO machine_project (project_id, addresses) VALUES (?, ?)")
      .run(projectId, JSON.stringify(addresses));
  }

  /** Fingerprint of the Model config a machine last received for a Project, or null. */
  syncPrint(address: string, projectId: string): string | null {
    const row = this.db
      .prepare("SELECT fingerprint FROM machine_model_sync WHERE address = ? AND project_id = ?")
      .get(address, projectId);
    return row ? (row.fingerprint as string) : null;
  }

  setSyncPrint(address: string, projectId: string, fingerprint: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO machine_model_sync (address, project_id, fingerprint) VALUES (?, ?, ?)",
      )
      .run(address, projectId, fingerprint);
  }
}

function toConnect(row: Record<string, unknown>): ConnectState {
  return {
    port: row.port as number,
    ...(row.machine_id === null ? {} : { machineId: row.machine_id as string }),
    ...(row.tunnel_pid === null ? {} : { tunnelPid: row.tunnel_pid as number }),
    ...(row.connected_at === null ? {} : { connectedAt: row.connected_at as string }),
  };
}
