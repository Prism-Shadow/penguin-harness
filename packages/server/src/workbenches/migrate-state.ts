/**
 * Moves an Agent's workbenches from where they were kept before Agent State into it, with the
 * versions recorded there, and then leaves a link in the old place.
 *
 *   <agentDir>/workbenches/<id>/                → <agentDir>/agent_state/workbenches/<id>/: `state.json`
 *                                                 and the server's dot entries travel as they are
 *   <agentDir>/workbenches-history/<id>/<rev>/  → the id's versions as commits (./repo.ts), oldest first
 *                                                 and dated with each one's `savedAt`
 *   <agentDir>/workbenches-history/<id>/        → <agentDir>/.workbench-migration/backup/workbenches-history/<id>/,
 *                                                 kept for recovery: nothing deletes it
 *   <agentDir>/workbenches                      → once emptied, a directory link to `agent_state/workbenches`
 *                                                 (a junction on Windows, a symlink elsewhere)
 *
 * Every access looks at the old place with one lstat: absent or a link, there is nothing to do.
 * The link is what an Agent following an installed copy of the `penguin-plugin` Skill from before
 * Agent State writes through, so its files land in the new place; while it stands, its target is
 * kept in existence (an Agent State import can swap in one without workbenches).
 *
 * While the old place is still a real directory, a folder moves only once it is a workbench (it
 * has a `package.json`), its source has settled (no file of it changed for SETTLE_MS, so a folder
 * an Agent is still writing is left alone) and its id is free in Agent State, compared without
 * case or Unicode form so the State still copies onto a case-folding disk. A folder that waits is
 * picked up by a later access; an id that is taken stays where it is, reported once per process.
 * Only the old copies are committed: the folder itself is recorded by its first load that
 * succeeds, like any edit. A folder moves only after its versions are committed, so a run cut
 * short is finished by the next one, which commits no version twice. Importing the versions is
 * best effort, the move is not: a version that cannot be read, or a repository that cannot be
 * written, is logged and skipped, and its copy is kept with the others.
 *
 * Compatibility owner: the Workbench maintainers. Keep this, and the link it leaves, until the
 * next major version (1.0); it is not removed with the Workflow conversion at 0.3.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AgentStateRepo, agentStateRepoDir } from "./repo.js";
import { isWorkbenchId, readFolder, readLoadedSource, type WorkbenchFolder } from "./store.js";

/** How long a folder's source must have been left alone before it moves. */
export const SETTLE_MS = 10 * 60 * 1000;
/** A recorded revision names a directory of the history; nothing else may be joined onto it. */
const REVISION = /^[a-f0-9]{12}$/;
/** What this process has already reported, so a state that lasts is logged once. */
const reported = new Set<string>();

export interface StateMigrationOptions {
  /** Where what could not be moved, linked or imported is reported. */
  log?: (line: string) => void;
  /** The old folders were just written by the server itself, so none needs to settle. */
  settled?: boolean;
}

/** One version a `versions.json` lists, readable, with the time it was recorded. */
interface OldVersion {
  folder: WorkbenchFolder;
  at: Date;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown) => (err as NodeJS.ErrnoException).code;
/** Two names one case-folding, normalising disk would hold as one. */
const folded = (name: string) => name.normalize("NFC").toLowerCase();

export async function migrateWorkbenchesIntoState(
  agentDir: string,
  opts: StateMigrationOptions = {},
): Promise<void> {
  const old = path.join(agentDir, "workbenches");
  const target = path.join(agentDir, "agent_state", "workbenches");
  let kind: import("node:fs").Stats;
  try {
    kind = await fs.lstat(old);
  } catch (err) {
    if (codeOf(err) === "ENOENT") return;
    throw err;
  }
  if (kind.isSymbolicLink()) {
    await fs.mkdir(target, { recursive: true });
    return;
  }
  if (!kind.isDirectory()) return;

  const log = opts.log ?? ((line: string) => console.log(line));
  const once = (key: string, line: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    log(line);
  };
  const taken = new Set(
    (await fs.readdir(target).catch(() => [] as string[])).map((name) => folded(name)),
  );
  const ready: WorkbenchFolder[] = [];
  for (const entry of (await fs.readdir(old, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const dir = path.join(old, entry.name);
    if (!entry.isDirectory() || !isWorkbenchId(entry.name)) {
      once(dir, `[workbenches] ${dir} is not a workbench folder; left in place`);
      continue;
    }
    if (taken.has(folded(entry.name))) {
      once(dir, `[workbenches] ${dir} left in place: its id is taken in agent_state/workbenches`);
      continue;
    }
    const folder = await readFolder(dir, entry.name);
    // Not a workbench yet, or still being written: a later access looks again.
    if (folder === null || (opts.settled !== true && !(await settled(folder)))) continue;
    taken.add(folded(entry.name));
    ready.push(folder);
  }

  const history = path.join(agentDir, "workbenches-history");
  const backup = path.join(agentDir, ".workbench-migration", "backup", "workbenches-history");
  if (ready.length > 0) {
    const repo = new AgentStateRepo({
      gitdir: agentStateRepoDir(agentDir),
      now: () => new Date(),
      log: (line) => log(`[workbenches] ${line}`),
    });
    await fs.mkdir(target, { recursive: true });
    for (const folder of ready) {
      try {
        await importVersions(repo, folder, path.join(history, folder.id), log);
      } catch (err) {
        log(`[workbenches] ${folder.id}: old versions not imported: ${messageOf(err)}`);
      }
      try {
        await fs.rename(folder.dir, path.join(target, folder.id));
      } catch (err) {
        log(`[workbenches] ${folder.dir} not moved: ${messageOf(err)}`);
        continue;
      }
      const copies = path.join(history, folder.id);
      await fs.mkdir(backup, { recursive: true });
      await fs.rename(copies, path.join(backup, folder.id)).catch((err) => {
        if (codeOf(err) !== "ENOENT")
          log(`[workbenches] ${copies} kept in place: ${messageOf(err)}`);
      });
    }
    await fs.rmdir(history).catch(() => undefined);
  }
  await linkOldPlace(old, target, once);
}

/** Replaces the emptied old directory with a link to the new one; a real directory otherwise. */
async function linkOldPlace(
  old: string,
  target: string,
  once: (key: string, line: string) => void,
): Promise<void> {
  if (reported.has(`link:${old}`)) return;
  try {
    // Fails while anything is left in it, which then waits for a later access.
    await fs.rmdir(old);
  } catch {
    return;
  }
  await fs.mkdir(target, { recursive: true });
  try {
    // A junction needs no privilege on Windows and takes an absolute target; elsewhere a
    // relative one keeps the link valid wherever the data root is moved.
    if (process.platform === "win32") await fs.symlink(target, old, "junction");
    else await fs.symlink(path.join("agent_state", "workbenches"), old, "dir");
  } catch (err) {
    await fs.mkdir(old, { recursive: true });
    once(`link:${old}`, `[workbenches] ${old} not linked to ${target}: ${messageOf(err)}`);
  }
}

/** Whether no source file of the folder changed for SETTLE_MS. */
async function settled(folder: WorkbenchFolder): Promise<boolean> {
  const since = Date.now() - SETTLE_MS;
  for (const rel of folder.files) {
    const stat = await fs.lstat(path.join(folder.dir, rel)).catch(() => null);
    if (stat === null || stat.mtimeMs > since) return false;
  }
  return true;
}

/**
 * Commits the workbench's old versions, oldest first. A workbench whose folder is gone has none
 * imported: a deleted workbench lists no history.
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
    const files = await readLoadedSource(version.folder);
    if (files === null) {
      log(`[workbenches] ${version.folder.dir} changed while it was read; not imported`);
      continue;
    }
    await repo.commitPath(rel, files, `workbench ${folder.id} @${version.folder.revision}`, {
      at: version.at,
    });
  }
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
    if (codeOf(err) === "ENOENT") return [];
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
