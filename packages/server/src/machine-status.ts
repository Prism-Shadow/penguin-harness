/**
 * "Is a server running on this data root, and which machine is this?" — answered from the
 * root itself, by whoever can read it, with no server needed and safely while one runs (the
 * same terms as `penguin auth token`, which writes to this database live).
 *
 * Exported as `@prismshadow/penguin-server/machine-status` for `penguin server status`, which
 * is how a CONTROLLER asks: it runs that one command over ssh and reads back JSON. The
 * question used to be asked in shell — `cat` the lock, `sed` the pid out of it, `kill -0`,
 * `cat` a second file for the id — which meant a parser on this side for a format with no
 * definition, and no answer at all from a Windows remote, `kill -0` having no cmd.exe
 * equivalent. Asking the machine's own CLI moves both problems to the side that has Node.
 *
 * Liveness is the local lock's own test (pid alive AND the port accepting), which the shell
 * version could not do: it only had `kill -0`, and a recycled pid reads as a live server.
 */
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./db/database.js";
import { MachinesRepo } from "./db/repos/machines.js";
import { liveServerLock } from "./lock.js";

/** What `penguin server status` prints, as one line of JSON. */
export interface MachineStatus {
  /** A server owns this root right now: its pid is alive and its port answers. */
  running: boolean;
  /** The live server's port and pid; null when nothing is running. */
  port: number | null;
  pid: number | null;
  /**
   * This machine's own id, or null when it has none yet — the id is minted the first time a
   * server boots here, so an installed-but-never-run machine legitimately has none, and
   * saying null is better than minting one to answer a question.
   */
  machineId: string | null;
}

/** `dbPath` may be elsewhere (PENGUIN_WEB_DB), as everywhere else that reads this database. */
export async function readMachineStatus(
  root: string,
  dbPath: string = path.join(root, "web.db"),
): Promise<MachineStatus> {
  const lock = await liveServerLock(root);
  return {
    running: lock !== null,
    port: lock?.port ?? null,
    pid: lock?.pid ?? null,
    machineId: readMachineId(dbPath),
  };
}

/**
 * Existence-checked before openDatabase, which would otherwise CREATE an empty database (and
 * the directory) on a root the server has never used — a status probe must not leave a data
 * root behind it.
 */
function readMachineId(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = openDatabase(dbPath);
  try {
    return new MachinesRepo(db).peekOwnId();
  } finally {
    db.close();
  }
}
