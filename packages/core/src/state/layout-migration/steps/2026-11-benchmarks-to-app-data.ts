/**
 * Step 2 (2026-11): Benchmarks into the Evaluation Center's data folder. A Project's
 * `projects/<p>/benchmarks/` moves to its system Agent's agent-level data of the app `benchmark`,
 * `projects/<p>/agents/system_agent/app/data/benchmark/` (benchmark-dirs.ts), and a link is left
 * at `benchmarks`. An old absolute path `<root>/<p>/benchmarks/…` then reaches the new folder
 * through both links, so a stale installed Skill copy or an open conversation still writes the
 * right place.
 *
 * The system Agent is provisioned first where the Project has none yet (PRFC-0033). Where the
 * Project's `system_agent` is an Agent of the user's (compat C1, system-agent.ts) there is no
 * Evaluation Center data folder: its Benchmarks stay where they are, and the run says so.
 *
 * Where the new folder already has a Benchmark of the same id (only something put there by hand
 * can be), that one Benchmark stays in the old folder with a warning, the old folder is not
 * replaced by a link, and the next start tries again.
 *
 * This step is kept apart from step 1 so it can be pointed elsewhere on its own. The Benchmarks
 * have since moved on, into the default Agent's Self-Evolution Workbench: the server's one-time
 * migration (packages/server's services/rsi-workbench-migration.ts) moves this step's folder there
 * at its next start and leaves a link in its place, so the chain of links reaches them from both
 * old places.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { provisionSystemAgent } from "../../agent-state.js";
import { benchmarksDir, legacyBenchmarksDir } from "../../benchmark-dirs.js";
import type { StepContext } from "../context.js";
import { LayoutMigrationError } from "../error.js";
import type { LayoutStepId } from "../journal.js";
import { linkDir } from "../link.js";
import { isRealDir, lstatOrNull, moveDir } from "../move.js";

export const BENCHMARKS_TO_APP_DATA: LayoutStepId = "2026-11-benchmarks-to-app-data";

/** Whether the Project still keeps its Benchmarks in the old folder (a real `benchmarks/`). */
export async function hasLegacyBenchmarks(root: string, projectId: string): Promise<boolean> {
  return isRealDir(legacyBenchmarksDir(root, projectId));
}

/** Step 2 for one Project. */
export async function moveBenchmarks(ctx: StepContext, projectId: string): Promise<void> {
  const legacy = legacyBenchmarksDir(ctx.root, projectId);
  const target = benchmarksDir(ctx.root, projectId);
  const unfinished = ctx.unfinished(BENCHMARKS_TO_APP_DATA).includes(projectId);
  const at = await lstatOrNull(legacy);
  if (at === null || !at.isDirectory()) {
    try {
      // A run cut short between moving the folder and linking it: the link is still owed.
      if (at === null && unfinished && (await isRealDir(target))) await linkDir(legacy, target);
    } catch (err) {
      throw failed(projectId, legacy, target, err);
    }
    if (unfinished) await ctx.finish(BENCHMARKS_TO_APP_DATA, projectId);
    return;
  }
  try {
    if (!(await provisionSystemAgent({ root: ctx.root, projectId }))) {
      ctx.log(
        `[layout] ${projectId}: its system_agent is an Agent of the user's, so its Benchmarks ` +
          `stay in ${legacy}`,
      );
      if (unfinished) await ctx.finish(BENCHMARKS_TO_APP_DATA, projectId);
      return;
    }
    await ctx.begin(BENCHMARKS_TO_APP_DATA, projectId);
    // The levels of an app's folders are this user's alone, as the workbench host makes them.
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    if ((await lstatOrNull(target)) === null) {
      await moveDir(legacy, target);
    } else {
      let kept = 0;
      for (const name of await fs.readdir(legacy)) {
        if ((await lstatOrNull(path.join(target, name))) !== null) {
          kept += 1;
          ctx.log(
            `[layout] ${projectId}: ${path.join(legacy, name)} stays where it is: ` +
              `${path.join(target, name)} already exists. Move one of them by hand; the next ` +
              `start moves the rest.`,
          );
          continue;
        }
        await moveDir(path.join(legacy, name), path.join(target, name));
      }
      if (kept > 0) {
        await ctx.finish(BENCHMARKS_TO_APP_DATA, projectId);
        return;
      }
      await fs.rmdir(legacy);
    }
    await linkDir(legacy, target);
    ctx.log(`[layout] ${projectId}: moved its Benchmarks to ${target}`);
    await ctx.finish(BENCHMARKS_TO_APP_DATA, projectId);
  } catch (err) {
    throw failed(projectId, legacy, target, err);
  }
}

function failed(projectId: string, legacy: string, target: string, err: unknown) {
  return new LayoutMigrationError(
    "step_failed",
    `The Benchmarks of the Project "${projectId}" could not be moved from ${legacy} to ` +
      `${target} (${err instanceof Error ? err.message : String(err)}). Fix the cause, then ` +
      `start again and the move goes on from where it stopped.`,
  );
}
