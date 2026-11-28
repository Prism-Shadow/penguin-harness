/**
 * Moves an Agent's workbenches from where they were kept before Agent State into it, with the
 * versions recorded there, and then leaves a link in the old place.
 *
 *   <agentDir>/workbenches/<id>/                → <agentDir>/agent_state/workbenches/<id>/: `state.json`
 *                                                 and the server's dot entries travel as they are
 *   <agentDir>/workbenches-history/<id>/<rev>/  → the id's versions as commits (./repo.ts), oldest first
 *                                                 and dated with each one's `savedAt`
 *   <agentDir>/workbenches-history/<id>/        → <agentDir>/.workbench-migration/backup/workbenches-history/<id>/
 *   <agentDir>/workbenches/<anything else>      → <agentDir>/.workbench-migration/backup/workbenches/<name>
 *   <agentDir>/workbenches                      → once emptied, a directory link to `agent_state/workbenches`
 *                                                 (a junction on Windows, a symlink elsewhere)
 *
 * The backup keeps what it is given for recovery; nothing reads or deletes it.
 *
 * Every access looks at the old place with one lstat: absent or a link, there is nothing to do.
 * The link is what an Agent following an installed copy of the `penguin-plugin` Skill from before
 * Agent State writes through, so its files land in the new place; while it stands, its target is
 * kept in existence (an Agent State import can swap in one without workbenches).
 *
 * While the old place is still a real directory, an entry is handled once it has settled, so
 * what an Agent is still writing is left alone: a workbench (a folder with a `package.json`)
 * when none of its source files changed for SETTLE_MS, anything else when nothing in it did.
 * Then a workbench whose id is free in Agent State, compared without case or Unicode form so
 * the State still copies onto a case-folding disk, moves in; one whose id is taken stays where
 * it is, reported once per process; and anything else (a file such as `.DS_Store`, an invalid
 * name, a folder without a `package.json`) goes to the backup, so it never keeps the link from
 * being made. Only the old copies are committed: the folder itself is recorded by its first load
 * that succeeds, like any edit. A folder moves only after its versions are committed, so a run
 * cut short is finished by the next one, which commits no version twice. Importing the versions
 * is best effort, the move is not: a version that cannot be read, or a repository that cannot
 * be written, is logged and skipped, and its copy is kept with the others.
 *
 * Compatibility owner: the Workbench maintainers. Keep this, and the link it leaves, until the
 * next major version (1.0); it is not removed with the Workflow conversion at 0.3.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { GitEngine } from "@prismshadow/penguin-core/plugin";
import { AgentStateRepo, agentStateRepoDir } from "./repo.js";
import { isWorkbenchId, readFolder, readLoadedSource, type WorkbenchFolder } from "./store.js";

/** How long an entry must have been left alone before it is moved. */
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
  /** The deployment's Agent State engine, which records the imported versions (./repo.ts). */
  engine: GitEngine | (() => GitEngine);
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

const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    (err) => {
      if (codeOf(err) === "ENOENT") return false;
      throw err;
    },
  );

/** Moves `source` into `dir` under its own name, or a numbered one when that is taken there. */
async function backUp(source: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const name = path.basename(source);
  let dest = path.join(dir, name);
  for (let n = 1; await exists(dest); n++) dest = path.join(dir, `${name}.${n}`);
  await fs.rename(source, dest);
  return dest;
}

const LINK_PENDING_FILE = "link-pending";
const PENDING_HISTORY_DIR = "pending-history";

async function createCompatibilityLink(
  old: string,
  target: string,
  linkPending: string,
  once: (key: string, line: string) => void,
): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  try {
    // A junction needs no privilege on Windows and takes an absolute target; elsewhere a
    // relative one keeps the link valid wherever the data root is moved.
    if (process.platform === "win32") await fs.symlink(target, old, "junction");
    else await fs.symlink(path.join("agent_state", "workbenches"), old, "dir");
    await fs.rm(linkPending, { force: true }).catch(() => undefined);
  } catch (err) {
    if (codeOf(err) === "EEXIST") {
      const existing = await fs.lstat(old).catch(() => null);
      if (existing?.isSymbolicLink()) {
        await fs.rm(linkPending, { force: true }).catch(() => undefined);
      }
      return;
    }
    await fs.mkdir(old, { recursive: true }).catch(() => undefined);
    once(`link:${old}`, `[workbenches] ${old} not linked to ${target}: ${messageOf(err)}`);
  }
}

/**
 * Keeps the old place's link leading somewhere: while `<agentDir>/workbenches` is a link, its
 * target exists. Also repairs a compatibility link interrupted between `rmdir` and `symlink`.
 * For whatever replaces `agent_state/` wholesale.
 */
export async function ensureWorkbenchLinkTarget(agentDir: string): Promise<void> {
  const old = path.join(agentDir, "workbenches");
  const target = path.join(agentDir, "agent_state", "workbenches");
  const linkPending = path.join(agentDir, ".workbench-migration", LINK_PENDING_FILE);
  const kind = await fs.lstat(old).catch(() => null);
  if (kind?.isSymbolicLink()) {
    await fs.mkdir(target, { recursive: true });
    await fs.rm(linkPending, { force: true }).catch(() => undefined);
    return;
  }
  if (kind === null && (await exists(linkPending))) {
    await createCompatibilityLink(old, target, linkPending, () => undefined);
  }
}

/**
 * Retries importing backed-up legacy history recorded in `.workbench-migration/pending-history/`
 * when the Git engine was temporarily unready or failed during the live workbench move (Major #6).
 */
async function retryPendingHistoryImports(
  agentDir: string,
  target: string,
  journal: string,
  opts: StateMigrationOptions,
  log: (line: string) => void,
): Promise<void> {
  const pendingDir = path.join(journal, PENDING_HISTORY_DIR);
  const stat = await fs.lstat(pendingDir).catch(() => null);
  if (!stat || !stat.isDirectory()) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(pendingDir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.length === 0) {
    await fs.rmdir(pendingDir).catch(() => undefined);
    return;
  }

  let repo: AgentStateRepo | null = null;
  let engineErr: unknown = null;
  try {
    const resolvedEngine = typeof opts.engine === "function" ? opts.engine() : opts.engine;
    repo = new AgentStateRepo({
      gitdir: agentStateRepoDir(agentDir),
      now: () => new Date(),
      log: (line) => log(`[workbenches] ${line}`),
      engine: resolvedEngine,
    });
  } catch (err) {
    engineErr = err;
  }

  const resolvedAgent = path.resolve(agentDir);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !isWorkbenchId(entry.name)) continue;
    const id = entry.name;
    const markerPath = path.join(pendingDir, id);
    // A deleted workbench lists no history: clear the pending marker if the live folder is gone.
    if (!(await exists(path.join(target, id)))) {
      await fs.rm(markerPath, { force: true }).catch(() => undefined);
      continue;
    }
    let backupSource: string;
    try {
      backupSource = (await fs.readFile(markerPath, "utf8")).trim();
    } catch {
      continue;
    }
    let resolvedSource = path.resolve(agentDir, backupSource);
    if (
      !resolvedSource.startsWith(`${resolvedAgent}${path.sep}`) ||
      !(await exists(resolvedSource))
    ) {
      // If interrupted between `backUp` rename and updating the write-ahead marker, fall back to
      // the canonical backup path for this workbench id (Major #7).
      const fallbackBackup = path.resolve(journal, "backup", "workbenches-history", id);
      if (
        fallbackBackup.startsWith(`${resolvedAgent}${path.sep}`) &&
        (await exists(fallbackBackup))
      ) {
        resolvedSource = fallbackBackup;
      } else {
        await fs.rm(markerPath, { force: true }).catch(() => undefined);
        continue;
      }
    }
    if (repo === null) {
      const key = `pending-engine:${markerPath}`;
      if (!reported.has(key)) {
        reported.add(key);
        log(`[workbenches] ${id}: old versions not imported: ${messageOf(engineErr)}`);
      }
      continue;
    }
    try {
      const rel = `workbenches/${id}`;
      const hadRecordedBefore = (await repo.history(rel, { limit: 1, walk: 1 })).length > 0;
      const importedCount = await importVersions(repo, id, resolvedSource, log);
      // If live commits already existed before this delayed legacy import, re-commit the live
      // workbench folder on top so HEAD never regresses to an older legacy revision (Major #8).
      if (hadRecordedBefore && importedCount > 0) {
        const liveDir = path.join(target, id);
        const liveFolder = await readFolder(liveDir, id);
        if (liveFolder !== null) {
          const liveFiles = await readLoadedSource(liveFolder);
          if (liveFiles === null) {
            throw new Error(
              `live workbench ${id} changed while restoring HEAD after history retry`,
            );
          }
          await repo.commitPath(rel, liveFiles, `workbench ${id} @${liveFolder.revision}`);
        }
      }
    } catch (err) {
      const key = `pending-retry:${markerPath}:${messageOf(err)}`;
      if (!reported.has(key)) {
        reported.add(key);
        log(`[workbenches] ${id}: old versions not imported: ${messageOf(err)}`);
      }
      continue;
    }
    await fs.rm(markerPath, { force: true }).catch(() => undefined);
  }
  await fs.rmdir(pendingDir).catch(() => undefined);
}

export async function migrateWorkbenchesIntoState(
  agentDir: string,
  opts: StateMigrationOptions,
): Promise<void> {
  const old = path.join(agentDir, "workbenches");
  const target = path.join(agentDir, "agent_state", "workbenches");
  const journal = path.join(agentDir, ".workbench-migration");
  const backupDir = path.join(journal, "backup");
  const linkPending = path.join(journal, LINK_PENDING_FILE);
  const log = opts.log ?? ((line: string) => console.log(line));
  const once = (key: string, line: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    log(line);
  };

  let kind: import("node:fs").Stats | null;
  try {
    kind = await fs.lstat(old);
  } catch (err) {
    if (codeOf(err) === "ENOENT") {
      kind = null;
    } else {
      throw err;
    }
  }

  if (kind === null) {
    // Repair a compatibility link interrupted between `rmdir(old)` and `symlink` (Minor #11).
    if (await exists(linkPending)) {
      await createCompatibilityLink(old, target, linkPending, once);
    }
    await retryPendingHistoryImports(agentDir, target, journal, opts, log);
    return;
  }
  if (kind.isSymbolicLink()) {
    await fs.mkdir(target, { recursive: true });
    await fs.rm(linkPending, { force: true }).catch(() => undefined);
    await retryPendingHistoryImports(agentDir, target, journal, opts, log);
    return;
  }
  if (!kind.isDirectory()) {
    await retryPendingHistoryImports(agentDir, target, journal, opts, log);
    return;
  }
  const taken = new Set(
    (await fs.readdir(target).catch(() => [] as string[])).map((name) => folded(name)),
  );
  const ready: WorkbenchFolder[] = [];
  const others: string[] = [];
  for (const entry of (await fs.readdir(old, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const dir = path.join(old, entry.name);
    const folder =
      entry.isDirectory() && isWorkbenchId(entry.name) ? await readFolder(dir, entry.name) : null;
    if (folder !== null && taken.has(folded(entry.name))) {
      once(dir, `[workbenches] ${dir} left in place: its id is taken in agent_state/workbenches`);
      continue;
    }
    // Still being written: a later access looks again.
    if (opts.settled !== true && !(await (folder ? sourceSettled(folder) : entrySettled(dir))))
      continue;
    if (folder === null) {
      others.push(dir);
      continue;
    }
    taken.add(folded(entry.name));
    ready.push(folder);
  }

  for (const other of others) {
    try {
      const kept = await backUp(other, path.join(backupDir, "workbenches"));
      log(`[workbenches] ${other} is not a workbench; kept in ${kept}`);
    } catch (err) {
      log(`[workbenches] ${other} not moved to the backup: ${messageOf(err)}`);
    }
  }
  const history = path.join(agentDir, "workbenches-history");
  if (ready.length > 0) {
    await fs.mkdir(target, { recursive: true });
    let repo: AgentStateRepo | null = null;
    let engineErr: unknown = null;
    try {
      const resolvedEngine = typeof opts.engine === "function" ? opts.engine() : opts.engine;
      repo = new AgentStateRepo({
        gitdir: agentStateRepoDir(agentDir),
        now: () => new Date(),
        log: (line) => log(`[workbenches] ${line}`),
        engine: resolvedEngine,
      });
    } catch (err) {
      engineErr = err;
    }
    for (const folder of ready) {
      let imported = false;
      const copies = path.join(history, folder.id);
      const hasHistory = await exists(copies);
      try {
        if (repo !== null) {
          await importVersions(repo, folder.id, copies, log);
          imported = true;
        } else if (await exists(path.join(copies, "versions.json"))) {
          log(`[workbenches] ${folder.id}: old versions not imported: ${messageOf(engineErr)}`);
        } else {
          imported = true;
        }
      } catch (err) {
        log(`[workbenches] ${folder.id}: old versions not imported: ${messageOf(err)}`);
      }
      // Write-ahead pending history marker BEFORE moving the live folder or backing up history so
      // an interruption or marker write failure can never strand unimported history (Major #7).
      const pendingDir = path.join(journal, PENDING_HISTORY_DIR);
      const markerPath = path.join(pendingDir, folder.id);
      let wroteMarker = false;
      if (hasHistory && !imported) {
        try {
          await fs.mkdir(pendingDir, { recursive: true });
          const tmpMarker = path.join(
            pendingDir,
            `.${folder.id}.penguin-tmp-${process.pid}-${Date.now()}`,
          );
          await fs.writeFile(tmpMarker, `${path.relative(agentDir, copies)}\n`);
          await fs.rename(tmpMarker, markerPath);
          wroteMarker = true;
        } catch (err) {
          log(
            `[workbenches] ${folder.dir} left in place: cannot record pending history marker: ${messageOf(err)}`,
          );
          continue;
        }
      }
      try {
        await fs.rename(folder.dir, path.join(target, folder.id));
      } catch (err) {
        if (wroteMarker) await fs.rm(markerPath, { force: true }).catch(() => undefined);
        log(`[workbenches] ${folder.dir} not moved: ${messageOf(err)}`);
        continue;
      }
      if (!hasHistory) continue;
      let keptPath = copies;
      try {
        keptPath = await backUp(copies, path.join(backupDir, "workbenches-history"));
      } catch (err) {
        log(`[workbenches] ${copies} kept in place: ${messageOf(err)}`);
      }
      if (wroteMarker && keptPath !== copies) {
        try {
          const tmpMarker = path.join(
            pendingDir,
            `.${folder.id}.penguin-tmp-${process.pid}-${Date.now()}`,
          );
          await fs.writeFile(tmpMarker, `${path.relative(agentDir, keptPath)}\n`);
          await fs.rename(tmpMarker, markerPath);
        } catch (err) {
          log(
            `[workbenches] ${folder.id}: pending history marker kept at original path: ${messageOf(err)}`,
          );
        }
      }
    }
    await fs.rmdir(history).catch(() => undefined);
  }
  await linkOldPlace(old, target, journal, linkPending, once);
  await retryPendingHistoryImports(agentDir, target, journal, opts, log);
}

/** Replaces the emptied old directory with a link to the new one; a real directory otherwise. */
async function linkOldPlace(
  old: string,
  target: string,
  journal: string,
  linkPending: string,
  once: (key: string, line: string) => void,
): Promise<void> {
  if (reported.has(`link:${old}`)) return;
  // Record link intent BEFORE removing `old` so an interruption between `rmdir` and `symlink`
  // is repaired on the next access instead of permanently omitting the link (Minor #11).
  await fs.mkdir(journal, { recursive: true });
  await fs.writeFile(linkPending, "1\n");
  try {
    // Fails while anything is left in it, which then waits for a later access.
    await fs.rmdir(old);
  } catch {
    await fs.rm(linkPending, { force: true }).catch(() => undefined);
    return;
  }
  await createCompatibilityLink(old, target, linkPending, once);
}

/**
 * Whether no source file of the workbench changed for SETTLE_MS. Its `state.json` and dot entries
 * are the server's own writes, not an Agent's, and do not count.
 */
async function sourceSettled(folder: WorkbenchFolder): Promise<boolean> {
  const since = Date.now() - SETTLE_MS;
  for (const rel of folder.files) {
    const stat = await fs.lstat(path.join(folder.dir, rel)).catch(() => null);
    if (stat === null || stat.mtimeMs > since) return false;
  }
  return true;
}

/** Whether nothing in `file` (itself, and everything under it) changed for SETTLE_MS. */
async function entrySettled(file: string): Promise<boolean> {
  const stat = await fs.lstat(file).catch(() => null);
  if (stat === null || stat.mtimeMs > Date.now() - SETTLE_MS) return false;
  if (!stat.isDirectory()) return true;
  for (const name of await fs.readdir(file).catch(() => [] as string[])) {
    if (!(await entrySettled(path.join(file, name)))) return false;
  }
  return true;
}

/**
 * Commits the workbench's old versions, oldest first. A workbench whose folder is gone has none
 * imported: a deleted workbench lists no history.
 */
async function importVersions(
  repo: AgentStateRepo,
  id: string,
  historyDir: string,
  log: (line: string) => void,
): Promise<number> {
  const rel = `workbenches/${id}`;
  const versions = await oldVersions(historyDir, id, log);
  if (versions.length === 0) return 0;
  // Deduplicate against the full recorded history rather than the 50-entry UI display cap (Minor #10).
  const recorded = new Set(
    (await repo.history(rel, { limit: 1_000_000, walk: 1_000_000 })).map((v) => v.revision),
  );
  let committed = 0;
  for (const version of versions) {
    if (recorded.has(version.folder.revision)) continue;
    const files = await readLoadedSource(version.folder);
    if (files === null) {
      log(`[workbenches] ${version.folder.dir} changed while it was read; not imported`);
      continue;
    }
    const res = await repo.commitPath(rel, files, `workbench ${id} @${version.folder.revision}`, {
      at: version.at,
    });
    if (res.changed) committed += 1;
    recorded.add(version.folder.revision);
  }
  return committed;
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
