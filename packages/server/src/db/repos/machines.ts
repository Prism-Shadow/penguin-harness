/**
 * What this server remembers about machines: its own identity, one row per machine it has
 * installed on or reached (what is installed there, the session held to it), and which
 * machines each Project uses. All in web.db, so a hot swap or a restart reads back exactly
 * what the last generation wrote — the JSON file this replaces could not survive a schema
 * change, and nothing else this server remembers lives outside the database.
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export interface MachineRow {
  /** `ssh:<alias>` */
  address: string;
  /** That machine's own id, once heard. */
  machineId: string | null;
  /** What this server last installed there; null when it never has. */
  version: string | null;
  installedAt: string | null;
  /**
   * Non-null while a connection to it is HELD: the pid of the session as of the last connect.
   * A record of intent, not a handle — a restart or a hot push re-holds every machine with one,
   * and a disconnect clears it. It is never used to kill anything: a pid read back from a file
   * may by then be anyone's.
   */
  sessionPid: number | null;
  /** The port its server was bound to over there, as of the last connect. */
  remotePort: number | null;
  /** What the install found the machine to be; null until one has. The status probe speaks that dialect. */
  platform: "linux" | "darwin" | "win32" | null;
}

/** Everything but the address may be patched; absent fields keep their value. */
type MachinePatch = Partial<Omit<MachineRow, "address">>;

/**
 * 12 random bytes as base64url: 16 characters a person can read in a tooltip, 96 bits
 * against ids minted on machines that never coordinate.
 */
const MACHINE_ID_BYTES = 12;

export class MachinesRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * This server's own id if one has been minted, WITHOUT minting one — `penguin server
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

  get(address: string): MachineRow | null {
    const row = this.db.prepare("SELECT * FROM machines WHERE address = ?").get(address);
    return row === undefined ? null : toRow(row);
  }

  /**
   * Every row answering to a machine's own id — two aliases for one host are two rows with
   * one id. Newest install first, then by address, so the order is the same every time; which
   * of them to speak through is the service's to decide (it knows which has a session).
   */
  byMachineId(machineId: string): MachineRow[] {
    return this.db
      .prepare(
        "SELECT * FROM machines WHERE machine_id = ? ORDER BY installed_at DESC, address ASC",
      )
      .all(machineId)
      .map(toRow);
  }

  all(): MachineRow[] {
    return this.db.prepare("SELECT * FROM machines").all().map(toRow);
  }

  /** Writes the fields given, creating the row when there is none. */
  patch(address: string, patch: MachinePatch): void {
    const next: MachineRow = {
      ...(this.get(address) ?? {
        address,
        machineId: null,
        version: null,
        installedAt: null,
        sessionPid: null,
        remotePort: null,
        platform: null,
      }),
      ...patch,
    };
    this.db
      .prepare(
        "INSERT OR REPLACE INTO machines (address, machine_id, version, installed_at, session_pid, remote_port, platform) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        address,
        next.machineId,
        next.version,
        next.installedAt,
        next.sessionPid,
        next.remotePort,
        next.platform,
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
}

function toRow(row: Record<string, unknown>): MachineRow {
  return {
    address: row.address as string,
    machineId: (row.machine_id as string | null) ?? null,
    version: (row.version as string | null) ?? null,
    installedAt: (row.installed_at as string | null) ?? null,
    sessionPid: (row.session_pid as number | null) ?? null,
    remotePort: (row.remote_port as number | null) ?? null,
    platform: (row.platform as MachineRow["platform"]) ?? null,
  };
}
