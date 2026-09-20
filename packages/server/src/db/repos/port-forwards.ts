/**
 * The port forwards this server remembers: which port of which machine each Workspace
 * brought to this server's loopback, and the local port it was given. In web.db so a
 * restart or a hot swap reads back exactly what the last generation wrote — the local port
 * above all, because an address a person saved has to stay true.
 */
import type { DatabaseSync } from "node:sqlite";

export interface PortForwardRow {
  id: string;
  /** That machine's own id. */
  machineId: string;
  /** The Workspace directory on that machine. */
  workspace: string;
  remotePort: number;
  localPort: number;
  createdAt: string;
}

function toRow(row: Record<string, unknown>): PortForwardRow {
  return {
    id: row.id as string,
    machineId: row.machine_id as string,
    workspace: row.workspace as string,
    remotePort: row.remote_port as number,
    localPort: row.local_port as number,
    createdAt: row.created_at as string,
  };
}

export class PortForwardsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Every forward, oldest first — the order a list keeps as rows come and go. */
  all(): PortForwardRow[] {
    return this.db
      .prepare("SELECT * FROM port_forwards ORDER BY created_at, rowid")
      .all()
      .map((row) => toRow(row as Record<string, unknown>));
  }

  get(id: string): PortForwardRow | null {
    const row = this.db.prepare("SELECT * FROM port_forwards WHERE id = ?").get(id);
    return row ? toRow(row as Record<string, unknown>) : null;
  }

  find(machineId: string, workspace: string, remotePort: number): PortForwardRow | null {
    const row = this.db
      .prepare(
        "SELECT * FROM port_forwards WHERE machine_id = ? AND workspace = ? AND remote_port = ?",
      )
      .get(machineId, workspace, remotePort);
    return row ? toRow(row as Record<string, unknown>) : null;
  }

  byLocalPort(localPort: number): PortForwardRow | null {
    const row = this.db.prepare("SELECT * FROM port_forwards WHERE local_port = ?").get(localPort);
    return row ? toRow(row as Record<string, unknown>) : null;
  }

  insert(row: PortForwardRow): void {
    this.db
      .prepare(
        "INSERT INTO port_forwards (id, machine_id, workspace, remote_port, local_port, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.machineId, row.workspace, row.remotePort, row.localPort, row.createdAt);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM port_forwards WHERE id = ?").run(id);
  }
}
