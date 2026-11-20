/**
 * The layout migration's journal, `<root>/.layout-migration.json`, and the lock a run holds.
 *
 * The journal names what an interrupted run left half done, so the next run finishes it: each
 * step a Project is in the middle of (written before the step's first change to disk, removed
 * after its last), and the path moves whose stored copies in web.db are still to be rewritten —
 * a run without the server's database (the SDK) leaves those for the server's next start. A
 * Project that is done is not listed: what is left to do is read off the disk again at every
 * start, so a step that finished is never run a second time.
 *
 * Every write replaces the file whole (a temporary file renamed over it), and an empty journal
 * removes the file.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { LayoutMigrationError } from "./error.js";

/** The migration's steps, named by the month they shipped and what they do. */
export type LayoutStepId = "2026-11-projects-level" | "2026-11-benchmarks-to-app-data";

/** An absolute folder that moved: every stored path under `from` now lies under `to`. */
export interface PathMove {
  from: string;
  to: string;
}

export interface LayoutJournal {
  version: 1;
  /** The steps a run began for a Project and did not finish. */
  inProgress: { step: LayoutStepId; projectId: string }[];
  /** Moves whose copies in the server's database are not rewritten yet. */
  pendingStore: PathMove[];
}

export function journalPath(root: string): string {
  return path.join(root, ".layout-migration.json");
}

function emptyJournal(): LayoutJournal {
  return { version: 1, inProgress: [], pendingStore: [] };
}

function isMove(value: unknown): value is PathMove {
  const v = value as Partial<PathMove> | null;
  return typeof v?.from === "string" && typeof v.to === "string";
}

/**
 * The journal on disk; an empty one when there is none. One that cannot be read stops the run:
 * without it a Project moved in the middle of an earlier run would be left with its paths
 * unrewritten, and nothing would say so.
 */
export async function readJournal(root: string): Promise<LayoutJournal> {
  const file = journalPath(root);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyJournal();
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutJournal>;
    if (parsed.version !== 1) throw new Error(`version ${String(parsed.version)}`);
    return {
      version: 1,
      inProgress: (Array.isArray(parsed.inProgress) ? parsed.inProgress : []).filter(
        (e): e is LayoutJournal["inProgress"][number] =>
          typeof e?.projectId === "string" &&
          (e.step === "2026-11-projects-level" || e.step === "2026-11-benchmarks-to-app-data"),
      ),
      pendingStore: (Array.isArray(parsed.pendingStore) ? parsed.pendingStore : []).filter(isMove),
    };
  } catch (err) {
    throw new LayoutMigrationError(
      "journal_unreadable",
      `The data root's layout migration journal ${file} cannot be read ` +
        `(${err instanceof Error ? err.message : String(err)}). Nothing was moved. Restore the ` +
        `file, or remove it if no earlier start was interrupted while moving Projects, then start again.`,
    );
  }
}

export async function writeJournal(root: string, journal: LayoutJournal): Promise<void> {
  const file = journalPath(root);
  if (journal.inProgress.length === 0 && journal.pendingStore.length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** `<root>/.layout-migration.lock`: held for the length of one run. */
export function lockPath(root: string): string {
  return path.join(root, ".layout-migration.lock");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The run of this process each data root is waiting on, by resolved root. */
const running = new Map<string, Promise<void>>();

/** How long a run waits for another process's run to end before it gives up. */
const LOCK_WAIT_MS = 60_000;

/**
 * Runs `fn` holding the migration lock: two processes opening one data root at once (two SDK
 * programs, or one and a server starting) never move the same folder. A lock whose process is
 * gone is stale and taken over; a live one is waited for, up to a minute.
 */
export async function withMigrationLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  // One run at a time inside this process as well: the lock file names a process, not a run.
  const key = path.resolve(root);
  const before = running.get(key) ?? Promise.resolve();
  const turn = before.then(() => holdingLock(root, fn));
  const settled = turn.then(
    () => undefined,
    () => undefined,
  );
  running.set(key, settled);
  void settled.then(() => {
    if (running.get(key) === settled) running.delete(key);
  });
  return turn;
}

async function holdingLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const file = lockPath(root);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await fs.writeFile(file, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const holder = Number.parseInt(await fs.readFile(file, "utf8").catch(() => ""), 10);
    // A lock with no pid in it yet is one being written right now, unless it has been so for long.
    const unnamed =
      !Number.isInteger(holder) &&
      Date.now() - ((await fs.stat(file).catch(() => null))?.mtimeMs ?? 0) > 5_000;
    if (unnamed || holder === process.pid || (Number.isInteger(holder) && !pidAlive(holder))) {
      await fs.rm(file, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new LayoutMigrationError(
        "migration_busy",
        `Another process (pid ${holder}) has been moving this data root's Projects for over a ` +
          `minute (${file}). Nothing was moved by this one; start it again once that process ends.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try {
    return await fn();
  } finally {
    await fs.rm(file, { force: true });
  }
}
