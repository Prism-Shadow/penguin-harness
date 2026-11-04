/**
 * Moves an Agent's workbenches from where they were kept before Agent State into it, with the
 * versions recorded there.
 *
 *   <agentDir>/workbenches/<id>/                → <agentDir>/agent_state/workbenches/<id>/ when that id is
 *                                                 free there: `state.json` and the server's dot entries
 *                                                 travel as they are
 *   <agentDir>/workbenches-history/<id>/<rev>/  → the id's versions as commits (./repo.ts), oldest first
 *                                                 and dated with each one's `savedAt`; then the folder
 *                                                 itself, when it differs from the newest
 *   <agentDir>/workbenches-history/<id>/        → <agentDir>/.workbench-migration/backup/workbenches-history/<id>/,
 *                                                 kept for recovery: nothing deletes it
 *
 * It runs on every access, not once: a workbench written to the old place later, by an Agent
 * following an installed copy of the `penguin-plugin` Skill from before Agent State, moves in on
 * the next access in the same way. Without the old folder that is one failed directory read. An
 * id already taken in Agent State stays where it is, reported once per process, and everything
 * else carries on. While Agent State has no workbenches folder yet, the old one moves whole.
 *
 * A folder moves only after its versions are committed, so a run cut short is finished by the
 * next one, which commits no version twice. Importing the versions is best effort, the move is
 * not: a version that cannot be read, or a repository that cannot be written, is logged and
 * skipped, and its copy is kept with the others.
 *
 * Compatibility owner: the Workbench maintainers. Keep until the next major version (1.0); this
 * step is not removed with the Workflow conversion at 0.3.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentStateRepo, agentStateRepoDir } from "./repo.js";
import { isWorkbenchId, readFolder, readLoadedSource, type WorkbenchFolder } from "./store.js";

/** A recorded revision names a directory of the history; nothing else may be joined onto it. */
const REVISION = /^[a-f0-9]{12}$/;
/** Old folders this process has already reported as left in place. */
const reported = new Set<string>();

export interface StateMigrationOptions {
  /** Where what could not be moved or imported is reported. */
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

export async function migrateWorkbenchesIntoState(
  agentDir: string,
  opts: StateMigrationOptions = {},
): Promise<void> {
  const old = path.join(agentDir, "workbenches");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(old, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw err;
  }
  const log = opts.log ?? ((line: string) => console.log(line));
  const target = path.join(agentDir, "agent_state", "workbenches");
  const whole = !(await exists(target));
  const ids: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !isWorkbenchId(entry.name)) continue;
    if (!whole && (await exists(path.join(target, entry.name)))) {
      const left = path.join(old, entry.name);
      if (!reported.has(left)) {
        reported.add(left);
        log(
          `[workbenches] ${left} left in place: agent_state/workbenches/${entry.name} already exists`,
        );
      }
      continue;
    }
    ids.push(entry.name);
  }
  if (!whole && ids.length === 0) return;

  const history = path.join(agentDir, "workbenches-history");
  const backup = path.join(agentDir, ".workbench-migration", "backup", "workbenches-history");
  const repo = new AgentStateRepo({
    gitdir: agentStateRepoDir(agentDir),
    now: () => new Date(),
    log: (line) => log(`[workbenches] ${line}`),
  });
  for (const id of ids) {
    const folder = await readFolder(path.join(old, id), id);
    // A folder that is not a workbench (no package.json) moves without versions.
    if (folder === null) continue;
    try {
      await importVersions(repo, folder, path.join(history, id), log);
    } catch (err) {
      log(`[workbenches] ${id}: old versions not imported: ${messageOf(err)}`);
    }
  }

  const moved: string[] = [];
  if (whole) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(old, target);
    moved.push(...ids);
  } else {
    for (const id of ids) {
      try {
        await fs.rename(path.join(old, id), path.join(target, id));
        moved.push(id);
      } catch (err) {
        log(`[workbenches] ${path.join(old, id)} not moved: ${messageOf(err)}`);
      }
    }
    // Gone once nothing is left in it, so the next access stops at the first read.
    await fs.rmdir(old).catch(() => undefined);
  }
  for (const id of moved) {
    const copies = path.join(history, id);
    if (!(await exists(copies))) continue;
    await fs.mkdir(backup, { recursive: true });
    await fs.rename(copies, path.join(backup, id)).catch((err) => {
      log(`[workbenches] ${copies} kept in place: ${messageOf(err)}`);
    });
  }
  await fs.rmdir(history).catch(() => undefined);
}

/**
 * Commits the workbench's old versions oldest first, then the folder itself. A workbench whose
 * folder is gone has no versions imported: a deleted workbench lists no history.
 */
async function importVersions(
  repo: AgentStateRepo,
  folder: WorkbenchFolder,
  historyDir: string,
  log: (line: string) => void,
): Promise<void> {
  const rel = `workbenches/${folder.id}`;
  // A run cut short committed some of the same versions; they are not recorded twice.
  const recorded = new Set((await repo.history(rel)).map((v) => v.revision));
  for (const version of await oldVersions(historyDir, folder.id, log)) {
    if (recorded.has(version.folder.revision)) continue;
    await commit(repo, rel, version.folder, log, version.at);
  }
  // Unchanged content records nothing, so the newest version is not listed twice.
  await commit(repo, rel, folder, log);
}

/** Commits the folder as the version a load of it records, dated `at` (default: now). */
async function commit(
  repo: AgentStateRepo,
  rel: string,
  folder: WorkbenchFolder,
  log: (line: string) => void,
  at?: Date,
): Promise<void> {
  const files = await readLoadedSource(folder);
  if (files === null) {
    log(`[workbenches] ${folder.dir} changed while it was read; not imported`);
    return;
  }
  await repo.commitPath(
    rel,
    files,
    `workbench ${folder.id} @${folder.revision}`,
    at === undefined ? {} : { at },
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
