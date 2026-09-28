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
  /** `<kind>:<name>` — `ssh:<alias>`, `docker:<definition>` */
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

/**
 * A machine a person defined whose kind leaves the definition to the host (a container). The
 * spec is the kind's — what its define() answered — and only the kind reads it.
 */
export interface MachineDefinitionRow {
  address: string;
  kind: string;
  name: string;
  spec: Record<string, unknown>;
  createdAt: string;
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

  /** Forgets a machine's record — its definition went (machine_definitions); nothing over there is touched. */
  deleteMachine(address: string): void {
    this.db.prepare("DELETE FROM machines WHERE address = ?").run(address);
  }

  /** The definitions the host keeps for a kind, oldest first. */
  definitions(kind: string): MachineDefinitionRow[] {
    return this.db
      .prepare("SELECT * FROM machine_definitions WHERE kind = ? ORDER BY created_at, name")
      .all(kind)
      .map(toDefinition);
  }

  definition(address: string): MachineDefinitionRow | null {
    const row = this.db.prepare("SELECT * FROM machine_definitions WHERE address = ?").get(address);
    return row === undefined ? null : toDefinition(row);
  }

  /** Writes a definition, replacing one at the same address. */
  putDefinition(row: MachineDefinitionRow): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO machine_definitions (address, kind, name, spec, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.address, row.kind, row.name, JSON.stringify(row.spec), row.createdAt);
  }

  deleteDefinition(address: string): void {
    this.db.prepare("DELETE FROM machine_definitions WHERE address = ?").run(address);
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

function toDefinition(row: Record<string, unknown>): MachineDefinitionRow {
  let spec: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.spec as string);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      spec = parsed as Record<string, unknown>;
    }
  } catch {
    // A damaged spec reads as an empty one: the kind refuses it in its own words when reached.
  }
  return {
    address: row.address as string,
    kind: row.kind as string,
    name: row.name as string,
    spec,
    createdAt: row.created_at as string,
  };
}
