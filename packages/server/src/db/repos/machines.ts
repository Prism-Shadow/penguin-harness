/**
 * What this server remembers about machines: one row per machine it has installed on, and
 * which machines each Project uses. In web.db, so a hot swap or a restart reads back exactly
 * what the last generation wrote — the JSON file this replaces could not survive a schema
 * change, and nothing else this server remembers lives outside the database.
 *
 * `MachineRow` mirrors the table rather than the columns written today: the DDL lands in one
 * migration, and the fields nothing reads yet (a machine's own id, the session held to it)
 * are the table's, not this store's opinion of what matters.
 */
import type { DatabaseSync } from "node:sqlite";

export interface MachineRow {
  /** `ssh:<alias>` */
  address: string;
  /** That machine's own id, once heard. */
  machineId: string | null;
  /** What this server last installed there; null when it never has. */
  version: string | null;
  installedAt: string | null;
  /** The ssh session this server holds to it — recorded so a successor generation can close it. */
  sessionPid: number | null;
  /** The port its server was bound to over there, as of the last connect. */
  remotePort: number | null;
}

/** Everything but the address may be patched; absent fields keep their value. */
type MachinePatch = Partial<Omit<MachineRow, "address">>;

export class MachinesRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(address: string): MachineRow | null {
    const row = this.db.prepare("SELECT * FROM machines WHERE address = ?").get(address);
    return row === undefined ? null : toRow(row);
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
      }),
      ...patch,
    };
    this.db
      .prepare(
        "INSERT OR REPLACE INTO machines (address, machine_id, version, installed_at, session_pid, remote_port) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        address,
        next.machineId,
        next.version,
        next.installedAt,
        next.sessionPid,
        next.remotePort,
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
  };
}
