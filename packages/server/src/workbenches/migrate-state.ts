/**
 * One-time move of an Agent's workbenches into its Agent State, with their recorded versions.
 *
 *   <agentDir>/workbenches/<id>/                → <agentDir>/agent_state/workbenches/<id>/, one rename:
 *                                                 `state.json` and the server's dot entries travel as they are
 *   <agentDir>/workbenches-history/<id>/<rev>/  → one commit per version its `versions.json` lists, oldest
 *                                                 first, dated with that version's `savedAt`; then the live
 *                                                 folder, when it differs from the newest
 *   <agentDir>/workbenches-history/             → <agentDir>/.workbench-migration/backup/workbenches-history/,
 *                                                 kept for recovery: nothing deletes it
 *
 * Journal, in the Workflow conversion's directory (./migrate.ts): `state-started` once the
 * preconditions held, `state-complete` at the end. Between the two every step is redone or
 * skipped by what is on disk, so a run that was interrupted is finished by the next one, and a
 * version an interrupted run already committed is not committed again. An Agent with neither old
 * directory is left alone, journal included. The old folder and the new one both present stops
 * before anything moves: an independently made workbench is never merged into a migrated one.
 *
 * Importing the old versions is best effort, the move is not: a version that cannot be read, or a
 * repository that cannot be written, is logged and skipped, its copy staying in the backup, while
 * the workbench itself always arrives in its new place.
 *
 * Compatibility owner: the Workbench maintainers. Keep until the next major version (1.0); this
 * step is not removed with the Workflow conversion at 0.3.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AgentStateRepo, type SourceFile } from "./repo.js";
import { listFolders, readFolder, type WorkbenchFolder } from "./store.js";

const JOURNAL = ".workbench-migration";
const STARTED = "state-started";
const COMPLETE = "state-complete";
/** A recorded revision names a directory of the history; nothing else may be joined onto it. */
const REVISION = /^[a-f0-9]{12}$/;

export interface StateMigrationOptions {
  /** Where versions that could not be imported are reported. */
  log?: (line: string) => void;
}

/** One version a `versions.json` lists, readable, with the time it was recorded. */
interface OldVersion {
  folder: WorkbenchFolder;
  at: Date;
}

const exists = async (file: string) =>
  fs.stat(file).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Where an Agent's workbenches live: `<agentDir>/agent_state/workbenches`. */
const stateWorkbenchesDir = (agentDir: string) => path.join(agentDir, "agent_state", "workbenches");

export async function migrateWorkbenchesIntoState(
  agentDir: string,
  opts: StateMigrationOptions = {},
): Promise<void> {
  const journal = path.join(agentDir, JOURNAL);
  if (await exists(path.join(journal, COMPLETE))) return;
  const live = path.join(agentDir, "workbenches");
  const history = path.join(agentDir, "workbenches-history");
  const target = stateWorkbenchesDir(agentDir);
  const backup = path.join(journal, "backup", "workbenches-history");
  const started = path.join(journal, STARTED);
  if (!(await exists(started))) {
    if (!(await exists(live)) && !(await exists(history))) return;
    if (await exists(target)) {
      throw new Error(
        `Cannot migrate: agent_state/workbenches already exists in ${agentDir}. Move it aside before retrying; the workbenches/ files are unchanged.`,
      );
    }
    await fs.mkdir(journal, { recursive: true });
    await fs.writeFile(started, "1\n");
  }
  if (await exists(history)) {
    if (await exists(backup)) throw new Error(`Migration backup already exists: ${backup}`);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(history, backup);
  }
  if (await exists(live)) {
    if (await exists(target)) throw new Error(`Migration destination already exists: ${target}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(live, target);
  }
  const log = opts.log ?? ((line: string) => console.log(line));
  const folders = await listFolders(target);
  if (folders.length > 0) {
    const repo = new AgentStateRepo({
      stateDir: path.dirname(target),
      now: () => new Date(),
      log,
    });
    for (const folder of folders) {
      try {
        await importVersions(repo, folder, path.join(backup, folder.id), log);
      } catch (err) {
        log(
          `[workbenches] ${folder.id}: old versions not imported: ${messageOf(err)}; the copies stay in ${backup}`,
        );
      }
    }
  }
  await fs.writeFile(path.join(journal, COMPLETE), "1\n");
}

/**
 * Commits the workbench's old versions oldest first, then its live folder. A workbench without
 * a live folder has no versions imported: a deleted workbench lists no history.
 */
async function importVersions(
  repo: AgentStateRepo,
  folder: WorkbenchFolder,
  historyDir: string,
  log: (line: string) => void,
): Promise<void> {
  const rel = `workbenches/${folder.id}`;
  const versions = await oldVersions(historyDir, folder.id, log);
  // An interrupted run committed a prefix of the same list; it is skipped, not recorded twice.
  const recorded = (await repo.history(rel)).reverse();
  let done = 0;
  while (
    done < recorded.length &&
    done < versions.length &&
    recorded[done]!.revision === versions[done]!.folder.revision
  )
    done += 1;
  for (const version of versions.slice(done)) {
    await repo.commitPath(rel, await sourceFiles(version.folder), subject(version.folder), {
      at: version.at,
    });
  }
  // Unchanged content records nothing, so the newest version is not listed twice.
  await repo.commitPath(rel, await sourceFiles(folder), subject(folder));
}

/** The commit subject a load of this folder records. */
const subject = (folder: WorkbenchFolder) => `workbench ${folder.id} @${folder.revision}`;

async function sourceFiles(folder: WorkbenchFolder): Promise<SourceFile[]> {
  return Promise.all(
    folder.files.map(async (rel) => ({ rel, body: await fs.readFile(path.join(folder.dir, rel)) })),
  );
}

/**
 * The versions `versions.json` lists (newest first on disk), oldest first. An entry that is not
 * a recorded version — a revision that names no directory of it, an unreadable time, a copy
 * that is gone or is not a workbench — is reported and left out.
 */
async function oldVersions(
  dir: string,
  id: string,
  log: (line: string) => void,
): Promise<OldVersion[]> {
  let listed: unknown;
  try {
    listed = JSON.parse(await fs.readFile(path.join(dir, "versions.json"), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log(`[workbenches] ${id}: versions.json not read: ${messageOf(err)}`);
    return [];
  }
  if (!Array.isArray(listed)) {
    log(`[workbenches] ${id}: versions.json is not a list`);
    return [];
  }
  const out: OldVersion[] = [];
  for (const entry of [...(listed as unknown[])].reverse()) {
    const { revision, savedAt } = (entry ?? {}) as { revision?: unknown; savedAt?: unknown };
    const at = new Date(typeof savedAt === "string" ? savedAt : Number.NaN);
    if (typeof revision !== "string" || !REVISION.test(revision) || Number.isNaN(at.getTime())) {
      log(`[workbenches] ${id}: a versions.json entry is not a recorded version; not imported`);
      continue;
    }
    const folder = await readFolder(path.join(dir, revision), id);
    if (folder === null) {
      log(`[workbenches] ${id}: version ${revision} has no readable copy; not imported`);
      continue;
    }
    out.push({ folder, at });
  }
  return out;
}
