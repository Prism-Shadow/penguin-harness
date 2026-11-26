/**
 * The data root's layout migration (PRFC-0034): Project folders move from the root's top level
 * into `projects/`, and Benchmarks into the Evaluation Center's data folder. Two steps, run in
 * order by every process that opens a data root with this code, before it uses the root:
 *
 *   steps/2026-11-projects-level.ts          `<root>/<p>/`              → `<root>/projects/<p>/`
 *   steps/2026-11-benchmarks-to-app-data.ts  `projects/<p>/benchmarks/` → `…/agents/system_agent/app/data/benchmark/`
 *
 * Who runs it: the server at its start, holding `server.lock`, before any route, runtime, file
 * watcher or the plugin loader (packages/server's `layout/`), with web.db as the store of the
 * paths it rewrites; the SDK's `createAgent` when no server holds the root
 * ({@link ensureDataRootLayout}), which leaves the web.db rewrite to the server's next start.
 *
 * It is checked at every start, not once behind a flag: whatever real Project folder is still at
 * the top level moves, one an older build made after a downgrade included, so a downgrade and an
 * upgrade again are safe. The journal (journal.ts) finishes a run that was cut short; a step that
 * finished is never run again. Old places keep a link to the new ones (link.ts).
 *
 * Compatibility owner: core's `state/layout-migration/`. The migration, its callers, the
 * listings' skipping of links and the links themselves stay until 1.0, when they are removed
 * together and a cleanup step deletes the links (changelog/0.2.19/
 * 2026-11-20-backward-compatibility.md).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { listProjectDirs } from "../project-dirs.js";
import { StepContext, type LayoutStore } from "./context.js";
import { LayoutMigrationError } from "./error.js";
import { journalPath, readJournal, withMigrationLock, type PathMove } from "./journal.js";
import { lstatOrNull } from "./move.js";
import { rekeyWorkspaceMemory } from "./rekey-memory.js";
import { serverHoldingRoot } from "./server-lock.js";
import {
  BENCHMARKS_TO_APP_DATA,
  hasLegacyBenchmarks,
  moveBenchmarks,
} from "./steps/2026-11-benchmarks-to-app-data.js";
import {
  checkProjectsLevel,
  legacyProjects,
  moveProjects,
  PROJECTS_LEVEL,
  rewriteMovedProject,
} from "./steps/2026-11-projects-level.js";

export { LayoutMigrationError } from "./error.js";
export type { LayoutMigrationCode } from "./error.js";
export type { LayoutStore } from "./context.js";
export type { PathMove } from "./journal.js";
export { movedPath } from "./rewrite.js";

export interface LayoutMigrationOptions {
  /** The host's stored copies of the paths; without one they are rewritten by the server later. */
  store?: LayoutStore;
  /** Where each move, and each thing left in place, is reported. */
  log?: (line: string) => void;
}

/** What a run did: the Projects it moved (or finished moving). */
export interface LayoutMigrationResult {
  movedProjects: string[];
}

/** The data roots this process has migrated or found current, by resolved path. */
const current = new Map<string, Promise<void>>();

/**
 * Migrates the data root at `root`. Throws a {@link LayoutMigrationError} when the root's layout
 * cannot be migrated as it stands or a Project folder cannot be moved — nothing is moved then —
 * or when a step fails after the folders moved; the steps that finished stay done, and the next
 * run goes on from where this one stopped.
 */
export async function migrateDataRootLayout(
  root: string,
  opts: LayoutMigrationOptions = {},
): Promise<LayoutMigrationResult> {
  const log = opts.log ?? (() => {});
  try {
    await fs.access(root);
  } catch {
    return { movedProjects: [] };
  }
  // What every start pays on a root that is already migrated: the checks that stop the run, one
  // listing of the top level and one `lstat` per Project. The lock is taken only for work.
  await checkProjectsLevel(root, []);
  if (!(await layoutHasWork(root))) {
    current.set(path.resolve(root), Promise.resolve());
    return { movedProjects: [] };
  }
  const result = await withMigrationLock(root, async () => {
    const ctx = new StepContext(root, await readJournal(root), opts.store ?? null, log);
    const legacy = await legacyProjects(root);
    await checkProjectsLevel(root, legacy);

    const ids = [...new Set([...ctx.unfinished(PROJECTS_LEVEL), ...legacy])];
    await moveProjects(ctx, ids);
    const moves: PathMove[] = [];
    const movedProjects: string[] = [];
    for (const id of ids) {
      const move = await rewriteMovedProject(ctx, id);
      if (move === null) continue;
      moves.push(move);
      movedProjects.push(id);
    }
    try {
      await ctx.rewriteStore(moves);
      await rekeyWorkspaceMemory(root, moves, log);
    } catch (err) {
      throw new LayoutMigrationError(
        "step_failed",
        `The paths recorded under the moved Projects could not be rewritten ` +
          `(${err instanceof Error ? err.message : String(err)}). The Projects stay moved; fix ` +
          `the cause, then start again and the rewrite is done then.`,
      );
    }
    for (const id of movedProjects) await ctx.finish(PROJECTS_LEVEL, id);

    const projects = (await listProjectDirs(root)).map((p) => p.id);
    for (const id of new Set([...ctx.unfinished(BENCHMARKS_TO_APP_DATA), ...projects])) {
      await moveBenchmarks(ctx, id);
    }
    return { movedProjects };
  });
  current.set(path.resolve(root), Promise.resolve());
  return result;
}

/** Whether a run has anything to do: a Project or its Benchmarks at an old place, or a journal. */
async function layoutHasWork(root: string): Promise<boolean> {
  if ((await legacyProjects(root)).length > 0) return true;
  if ((await lstatOrNull(journalPath(root))) !== null) return true;
  for (const { id } of await listProjectDirs(root)) {
    if (await hasLegacyBenchmarks(root, id)) return true;
  }
  return false;
}

/** Whether the root still holds a Project folder at its top level, or a run left one half moved. */
export async function layoutNeedsMigration(root: string): Promise<boolean> {
  if ((await legacyProjects(root)).length > 0) return true;
  try {
    return (await readJournal(root)).inProgress.some((e) => e.step === PROJECTS_LEVEL);
  } catch {
    return true;
  }
}

/**
 * The SDK's rule, run by `createAgent` before it opens the root (once per root per process): an
 * old layout is migrated when no server holds the root, and refused when one does — only the
 * server that holds it may move its folders, and it has its web.db open.
 */
export function ensureDataRootLayout(root: string): Promise<void> {
  const key = path.resolve(root);
  let done = current.get(key);
  if (done === undefined) {
    done = (async () => {
      if (!(await layoutNeedsMigration(key))) return;
      const pid = await serverHoldingRoot(key);
      if (pid !== null) {
        throw new LayoutMigrationError(
          "server_holds_root",
          `The data root ${key} still has the old layout (its Projects beside its own folders, ` +
            `not under projects/), and a server is running on it (pid ${pid}). That server ` +
            `predates the new layout and keeps the folders where they are; stop it, or start ` +
            `the new version's server, which moves them.`,
        );
      }
      await migrateDataRootLayout(key);
    })();
    current.set(key, done);
    done.catch(() => {
      if (current.get(key) === done) current.delete(key);
    });
  }
  return done;
}
