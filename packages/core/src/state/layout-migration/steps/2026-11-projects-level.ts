/**
 * Step 1 (2026-11): the `projects/` level. Every Project folder still at the data root's top
 * level, `<root>/<p>`, moves to `<root>/projects/<p>` (PRFC-0034):
 *
 * 1. `rename` it (one filesystem: atomic);
 * 2. leave a link at `<root>/<p>` (link.ts);
 * 3. rewrite the absolute paths its own files record under the old folder (rewrite.ts);
 * 4. rewrite the host's stored copies (web.db), or keep the move in the journal for the server;
 * 5. re-point each Agent's Windows `workbenches` junction, whose target is absolute;
 * 6. re-key the Memory of the Workspaces inside it (rekey-memory.ts, once for the whole run).
 *
 * Traces are never rewritten: their recorded paths resolve through the link. A Project folder an
 * older build makes at the top level after a downgrade is moved by the next start the same way.
 *
 * Before anything moves, the run is checked whole: a Project called `projects` holds the name
 * the new level needs, and a Project already under `projects/` and still at its old place has two
 * folders; either stops the run with nothing moved and nothing overwritten.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isValidId } from "../../agent-state.js";
import {
  agentsDir,
  legacyProjectDir,
  projectDir,
  projectsDir,
  PROJECTS_DIR_NAME,
} from "../../paths.js";
import type { StepContext } from "../context.js";
import { LayoutMigrationError } from "../error.js";
import type { LayoutStepId, PathMove } from "../journal.js";
import { linkDir, repointLink } from "../link.js";
import { isRealDir, lstatOrNull, moveDir } from "../move.js";
import { projectPathFiles, rewriteFilePaths } from "../rewrite.js";

export const PROJECTS_LEVEL: LayoutStepId = "2026-11-projects-level";

/** Whether `dir` is a Project's folder: a real directory holding `.project_config.toml`. */
async function isProjectFolder(dir: string): Promise<boolean> {
  if (!(await isRealDir(dir))) return false;
  return (await lstatOrNull(path.join(dir, ".project_config.toml"))) !== null;
}

/** The Projects whose folders are still at the top level of the data root, sorted. */
export async function legacyProjects(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const found: string[] = [];
  for (const name of names) {
    if (name === PROJECTS_DIR_NAME || name.startsWith(".") || !isValidId(name)) continue;
    if (await isProjectFolder(path.join(root, name))) found.push(name);
  }
  return found.sort();
}

/** The files that only a data root holds: one beside a `projects` folder makes it the Projects folder of that root. */
const DATA_ROOT_FILES = ["web.db", "server.lock", "install-id", ".layout-migration.json"];

/**
 * Stops the run before anything moves when the `projects/` level cannot be laid over this root:
 * the root is itself another root's Projects folder (a stale `PENGUIN_HOME="$(dirname
 * "$PROJECT_DIR")"` would start a server there and move every Project one level deeper), a
 * Project is called `projects`, `projects` is a file, or a Project to move already has a folder
 * under `projects/`.
 */
export async function checkProjectsLevel(root: string, ids: readonly string[]): Promise<void> {
  if (path.basename(root) === PROJECTS_DIR_NAME) {
    const parent = path.dirname(root);
    for (const name of DATA_ROOT_FILES) {
      if ((await lstatOrNull(path.join(parent, name))) !== null) {
        throw new LayoutMigrationError(
          "nested_data_root",
          `${root} is the Projects folder of the data root ${parent}, not a data root of its own: ` +
            `nothing was moved. Point PENGUIN_HOME (or --root) at ${parent} instead.`,
        );
      }
    }
  }
  const container = projectsDir(root);
  const stat = await lstatOrNull(container);
  if (stat !== null && !stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new LayoutMigrationError(
      "projects_not_a_folder",
      `${container} is a file, but the data root keeps its Projects in a folder of that name. ` +
        `Nothing was moved. Move that file elsewhere, then start this version again.`,
    );
  }
  if (await isProjectFolder(container)) {
    throw new LayoutMigrationError(
      "projects_id_collision",
      `The data root holds a Project named "projects", which is the name the new layout needs ` +
        `for its Projects folder (${container}). Nothing was moved. Start the previous version, ` +
        `move this Project's Agents to another Project (export, then import), delete the ` +
        `"projects" Project, then start this version again.`,
    );
  }
  for (const id of ids) {
    if ((await lstatOrNull(projectDir(root, id))) !== null) {
      throw new LayoutMigrationError(
        "project_folder_conflict",
        `The Project "${id}" has a folder both at ${legacyProjectDir(root, id)} and at ` +
          `${projectDir(root, id)}. Nothing was moved or overwritten. Keep the one that holds the ` +
          `Project, move the other out of the data root, then start this version again.`,
      );
    }
  }
}

/**
 * Steps 1–5 for one Project: answers its move, or null when there is nothing of it to finish (a
 * journal entry for a Project deleted since). Each part checks the disk before it acts, so a run
 * cut short anywhere is finished by the next one.
 */
export async function moveProject(ctx: StepContext, id: string): Promise<PathMove | null> {
  const from = legacyProjectDir(ctx.root, id);
  const to = projectDir(ctx.root, id);
  await ctx.begin(PROJECTS_LEVEL, id);
  try {
    if (await isRealDir(from)) {
      await fs.mkdir(projectsDir(ctx.root), { recursive: true });
      await moveDir(from, to);
      ctx.log(`[layout] moved the Project ${id} to ${to}`);
    } else if (!(await isRealDir(to))) {
      await ctx.finish(PROJECTS_LEVEL, id);
      return null;
    }
    await linkDir(from, to);
    const move = { from, to };
    for (const file of await projectPathFiles(to)) await rewriteFilePaths(file, [move]);
    for (const agent of await fs.readdir(agentsDir(ctx.root, id)).catch(() => [] as string[])) {
      await repointLink(path.join(agentsDir(ctx.root, id), agent, "workbenches"), from, to);
    }
    return move;
  } catch (err) {
    if (err instanceof LayoutMigrationError) throw err;
    throw new LayoutMigrationError(
      "step_failed",
      `The Project "${id}" could not be moved from ${from} to ${to} ` +
        `(${err instanceof Error ? err.message : String(err)}). Projects moved before it stay ` +
        `moved; fix the cause, then start again and the move goes on from where it stopped.`,
    );
  }
}
