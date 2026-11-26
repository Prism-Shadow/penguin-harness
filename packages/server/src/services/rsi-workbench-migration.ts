/**
 * The one-time migration of each Project to the Self-Evolution Workbench of the external built-in
 * plugin `@penguinharness/rsi-workbench` (PRFC-0036, "Compatibility"). Before it, the workbench was
 * this repository's `agent-evaluation` plugin, a stand-in drawn by the Web App, and the Benchmarks
 * were the Project's, in the system Agent's data folder. Now each Agent the workbench is on keeps
 * its own Benchmarks in that workbench's data folder, and the default Agent's are the Project's.
 *
 * WHEN. Every boot of a generation, after the data root's layout migration and before the plugin
 * closure is read and any workbench loads (hmr/platform.ts): a workbench that loaded first would
 * seed an empty data folder and find nothing of its own to show.
 *
 * WHAT, per Project, recorded in the ledger (project_data_migrations) under {@link MIGRATION}:
 *
 * 1. **The in-repo workbench is replaced.** On every Agent, a `benchmark` workbench whose install
 *    receipt names `agent-evaluation` is rewritten from the pinned package through the plugin
 *    installer, so its receipt names `rsi-workbench`, when its `index.ts`, `package.json` and
 *    `ui/icon.svg` are those `agent-evaluation` shipped ({@link PUBLISHED}; the App Center switch
 *    `penguin.appCenter.show` aside, which is carried over). Its `.disabled` and
 *    `.hidden-from-sidebar` markers, its `state.json` and its history stay; its first load commits
 *    the new files to the Agent State history. A copy someone edited is left as it is: core reads
 *    its receipt as `rsi-workbench`'s (state/workbench-owner-renames.ts), so its plugin card
 *    offers the update instead.
 * 2. **The default Agent gets the workbench once** where it has none (decision E1, kept in
 *    {@link installsWhereMissing}): through the same install an Agent's plugin page performs,
 *    recorded under {@link INSTALL}, so a later removal stands.
 * 3. **The Benchmarks move** from the system Agent's `app/data/benchmark/` — or, where the Project's
 *    `system_agent` is an Agent of the user's (compat C1), from the Project's old `benchmarks/`
 *    (core's benchmark-dirs.ts) — into the default Agent's workbench data
 *    `agents/default_agent/app/data/benchmark/`, the way the layout migration moved them before
 *    (core's state/layout-migration/steps/2026-11-benchmarks-to-app-data.ts): by rename, id by id
 *    where the target already holds some, a same-id conflict left in place with a log line and
 *    the old folder kept until the next start moves the rest. `.harbor/` goes to the workbench's
 *    cache folder instead, `.seeded` is written so the workbench does not seed over them, and a
 *    link (a junction on Windows) is left at the old place, so a stale Skill copy or a
 *    conversation that names the old path still reaches them. Recorded under {@link MOVE}, whose
 *    begun row is what tells a run cut short between the rename and the link that it owes the link.
 *
 * A Project is finished once all three are; a finished Project is never looked at again, and a
 * Project this build creates is recorded finished at its creation ({@link recordMigrated}), so
 * nothing here ever reaches it. A Project without a default Agent gets one first, as a Project's
 * creation would provision it; when that fails, nothing is moved or recorded and the next start
 * tries again. Each machine migrates its own data root in its own upgraded boot; nothing here
 * reaches another machine.
 *
 * NEVER THROWS. A Project that fails is logged with its cause and left unfinished, and the next
 * boot resumes it from what it finds on disk; the others go on.
 *
 * BACKWARD COMPATIBILITY. Kept until 1.0. Whoever prepares 1.0 removes this file, its call in
 * hmr/platform.ts and in ProjectService, core's benchmark-dirs.ts and workbench-owner-renames.ts,
 * the layout helpers core exports for it, and the project_data_migrations table with its repo (and
 * a migration that drops it), and deletes the links it left; see
 * changelog/unreleased/2026-11-26-backward-compatibility.md.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  agentDir,
  agentsDir,
  assertPluginWorkbenchesInstallable,
  BENCHMARK_APP_ID,
  DEFAULT_AGENT_ID,
  installPlugin,
  installPluginWorkbenches,
  isRealDir,
  isValidId,
  libraryPlugin,
  linkDir,
  lstatOrNull,
  moveDir,
  provisionProjectAgents,
  resolveBenchmarksDir,
  systemConfigPath,
  workbenchCacheDir,
  workbenchDataDir,
  workbenchesDir,
  WorkbenchNameTakenError,
} from "@prismshadow/penguin-core";
import type { LibraryPlugin } from "@prismshadow/penguin-core";
import type { ProjectDataMigrations } from "@prismshadow/penguin-library-setting";
import { listProjectIds } from "../plugin/loader.js";
import { writeAppCenterShow } from "../workbenches/app-center.js";
import { migrateWorkbenches } from "../workbenches/migrate.js";

/** The ledger's name for the whole migration of one Project. */
export const MIGRATION = "2026-11-26-rsi-workbench";
/** The ledger's name for the Benchmarks' move, begun before the first rename. */
export const MOVE = "2026-11-26-rsi-workbench-move";
/** The ledger's name for the one-time install on a default Agent without the workbench. */
export const INSTALL = "2026-11-26-rsi-workbench-install";

/** The plugin the workbench comes from now, and the one it came from before. */
const PLUGIN = "rsi-workbench";
const LEGACY_PLUGIN = "agent-evaluation";
/** The workbench id, which is also the name of its data and cache folders. */
const WORKBENCH = BENCHMARK_APP_ID;

/**
 * The files of the workbench `agent-evaluation` shipped, as sha256 hex, one entry per published
 * version: 2026.11.24.1 (b8eb08646) and 2026.11.25.1 (2d3b44933, the new icon). `index.ts` and
 * `ui/icon.svg` are hashed as they are; `package.json` as `JSON.stringify` of its parsed value
 * without `penguin.appCenter.show`, which the App Center switch rewrites (the published file is
 * in that same key order).
 */
const PUBLISHED: readonly Readonly<Record<"index.ts" | "package.json" | "ui/icon.svg", string>>[] =
  [
    {
      "index.ts": "7c58cef3b4fea9bcb9874124dba8f442df8aa190169035b138ca21704841e391",
      "package.json": "4f4ce6f65994442849c1d3e2ccbc26bf2645709d34b818886b98a1516118f9a9",
      "ui/icon.svg": "6e0cf94c8e416075ba5f28b7e45510f07488ef0c47988d8cfa696190b686aff9",
    },
    {
      "index.ts": "7c58cef3b4fea9bcb9874124dba8f442df8aa190169035b138ca21704841e391",
      "package.json": "758c4a58dfa09b7dac813a06886a1753c9504f48c2ff25fcf8ecefcd680d4a69",
      "ui/icon.svg": "25a0b587204a9716f1ecba8521e42fba319a4b1ec91f2e3cd32b6b4c95cc4868",
    },
  ];

/**
 * Decision E1 (2026-11-26): a default Agent that has no `benchmark` workbench gets the plugin
 * installed once, and never again once that is recorded. The other answers were to install
 * nothing (the Benchmarks still move, and the App Center offers the install) or to install it at
 * every start; either is this one line.
 */
function installsWhereMissing(): boolean {
  return true;
}

export interface RsiWorkbenchMigrationDeps {
  ledger: ProjectDataMigrations;
  root: string;
  now: () => string;
  log: (line: string) => void;
  /** The plugin's library entry; the library this generation reads, unless a suite hands its own. */
  plugin?: () => LibraryPlugin | undefined;
}

/** Whether the ledger records `name` as done in `projectId`. */
function finished(ledger: ProjectDataMigrations, name: string, projectId: string): boolean {
  const row = ledger.get(name, projectId);
  return row !== null && row.finishedAt !== null;
}

/** Records a Project this build created as migrated: there is nothing of the old shape in it. */
export function recordMigrated(ledger: ProjectDataMigrations, projectId: string, at: string): void {
  ledger.finish(MIGRATION, projectId, at);
}

/** Migrates every Project not finished yet. Never throws. */
export async function migrateToRsiWorkbench(deps: RsiWorkbenchMigrationDeps): Promise<void> {
  try {
    const pending = (await listProjectIds(deps.root)).filter(
      (projectId) => !finished(deps.ledger, MIGRATION, projectId),
    );
    if (pending.length === 0) return;
    const plugin = (deps.plugin ?? (() => libraryPlugin(PLUGIN)))();
    if (plugin?.workbenches?.some((w) => w.name === WORKBENCH) !== true) {
      deps.log(
        `[rsi-workbench] the plugin library has no ${PLUGIN} with a ${WORKBENCH} workbench, so no Project was migrated; the next start tries again`,
      );
      return;
    }
    for (const projectId of pending) {
      try {
        await migrateProject(deps, projectId, plugin);
      } catch (err) {
        deps.log(
          `[rsi-workbench] ${projectId}: not migrated yet, the next start goes on from where it stopped: ${reason(err)}`,
        );
      }
    }
  } catch (err) {
    deps.log(
      `[rsi-workbench] the Projects were not migrated, the next start tries again: ${reason(err)}`,
    );
  }
}

async function migrateProject(
  deps: RsiWorkbenchMigrationDeps,
  projectId: string,
  plugin: LibraryPlugin,
): Promise<void> {
  const { root, ledger, log, now } = deps;
  if (!(await hasDefaultAgent(root, projectId))) {
    try {
      await provisionProjectAgents({ root, projectId });
    } catch (err) {
      log(
        `[rsi-workbench] ${projectId}: it has no ${DEFAULT_AGENT_ID} and one could not be provisioned, so its Benchmarks stay where they are until the next start: ${reason(err)}`,
      );
      return;
    }
    if (!(await hasDefaultAgent(root, projectId))) {
      log(
        `[rsi-workbench] ${projectId}: it has no ${DEFAULT_AGENT_ID}, so its Benchmarks stay where they are until the next start`,
      );
      return;
    }
  }
  ledger.begin(MIGRATION, projectId, now());
  for (const agentId of await agentIds(root, projectId)) {
    await replaceInRepoWorkbench(deps, projectId, agentId, plugin);
  }
  if (installsWhereMissing()) await installOnce(deps, projectId, plugin);
  if (await moveBenchmarks(deps, projectId)) ledger.finish(MIGRATION, projectId, now());
}

async function hasDefaultAgent(root: string, projectId: string): Promise<boolean> {
  return (await lstatOrNull(systemConfigPath(root, projectId, DEFAULT_AGENT_ID))) !== null;
}

/** The Project's Agent folders, by id. */
async function agentIds(root: string, projectId: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(agentsDir(root, projectId), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isValidId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** The plugin the folder's install receipt names, as written; null without a readable one. */
async function receiptPlugin(dir: string): Promise<string | null> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(dir, ".plugin.json"), "utf8")) as unknown;
    const plugin = (data as { plugin?: unknown } | null)?.plugin;
    return typeof plugin === "string" ? plugin : null;
  } catch {
    return null;
  }
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The App Center switch of a workbench folder holding a copy `agent-evaluation` shipped, as its
 * `package.json` sets it (`undefined` when it does not); null when the copy was edited.
 */
async function publishedCopy(dir: string): Promise<{ show: boolean | undefined } | null> {
  const read = (rel: string) => fs.readFile(path.join(dir, ...rel.split("/"))).catch(() => null);
  const [index, manifest, icon] = await Promise.all([
    read("index.ts"),
    read("package.json"),
    read("ui/icon.svg"),
  ]);
  if (index === null || manifest === null || icon === null) return null;
  let pkg: unknown;
  try {
    pkg = JSON.parse(manifest.toString("utf8"));
  } catch {
    return null;
  }
  const penguin = isRecord(pkg) ? pkg["penguin"] : undefined;
  const appCenter = isRecord(penguin) ? penguin["appCenter"] : undefined;
  const show = isRecord(appCenter) ? appCenter["show"] : undefined;
  if (isRecord(appCenter)) delete appCenter["show"];
  const prints = {
    "index.ts": sha256(index),
    "package.json": sha256(JSON.stringify(pkg)),
    "ui/icon.svg": sha256(icon),
  };
  const shipped = PUBLISHED.some(
    (files) =>
      files["index.ts"] === prints["index.ts"] &&
      files["package.json"] === prints["package.json"] &&
      files["ui/icon.svg"] === prints["ui/icon.svg"],
  );
  return shipped ? { show: typeof show === "boolean" ? show : undefined } : null;
}

/** Step 1 for one Agent (see the module header). */
async function replaceInRepoWorkbench(
  deps: RsiWorkbenchMigrationDeps,
  projectId: string,
  agentId: string,
  plugin: LibraryPlugin,
): Promise<void> {
  const { root, log } = deps;
  const dir = path.join(workbenchesDir(root, projectId, agentId), WORKBENCH);
  if ((await receiptPlugin(dir)) !== LEGACY_PLUGIN) return;
  const copy = await publishedCopy(dir);
  if (copy === null) {
    log(
      `[rsi-workbench] ${projectId}/${agentId}: its ${WORKBENCH} workbench was edited, so it stays as it is; its plugin card offers the ${PLUGIN} update`,
    );
    return;
  }
  const only: LibraryPlugin = {
    ...plugin,
    workbenches: (plugin.workbenches ?? []).filter((w) => w.name === WORKBENCH),
  };
  await assertPluginWorkbenchesInstallable(root, projectId, agentId, [only]);
  await installPluginWorkbenches(root, projectId, agentId, only);
  // The package's manifest shows the tile; a switch someone turned off stays off.
  if (copy.show === false) await writeAppCenterShow(dir, false);
  log(
    `[rsi-workbench] ${projectId}/${agentId}: its ${WORKBENCH} workbench is now ${PLUGIN}'s (it was ${LEGACY_PLUGIN}'s, unedited)`,
  );
}

/** Step 2 (see the module header and {@link installsWhereMissing}). */
async function installOnce(
  deps: RsiWorkbenchMigrationDeps,
  projectId: string,
  plugin: LibraryPlugin,
): Promise<void> {
  const { root, ledger, log, now } = deps;
  if (finished(ledger, INSTALL, projectId)) return;
  const home = agentDir(root, projectId, DEFAULT_AGENT_ID);
  // As the install route does: a folder in the layout before Agent State moves first.
  await migrateWorkbenches(home);
  const dir = path.join(workbenchesDir(root, projectId, DEFAULT_AGENT_ID), WORKBENCH);
  if ((await lstatOrNull(dir)) === null) {
    try {
      await installPlugin(root, projectId, DEFAULT_AGENT_ID, plugin);
      log(
        `[rsi-workbench] ${projectId}: installed ${PLUGIN} on ${DEFAULT_AGENT_ID}, which had no ${WORKBENCH} workbench (once; removing it later is not undone)`,
      );
    } catch (err) {
      if (!(err instanceof WorkbenchNameTakenError)) throw err;
      log(
        `[rsi-workbench] ${projectId}: ${PLUGIN} was not installed on ${DEFAULT_AGENT_ID}: ${err.message}`,
      );
    }
  }
  ledger.finish(INSTALL, projectId, now());
}

/** Answers whether the move is done; false leaves it for the next start (see the module header). */
async function moveBenchmarks(
  deps: RsiWorkbenchMigrationDeps,
  projectId: string,
): Promise<boolean> {
  const { root, ledger, log, now } = deps;
  const source = await resolveBenchmarksDir(root, projectId);
  const target = workbenchDataDir(root, projectId, DEFAULT_AGENT_ID, WORKBENCH);
  const at = await lstatOrNull(source);
  if (at === null || !at.isDirectory()) {
    const move = ledger.get(MOVE, projectId);
    if (move !== null && move.finishedAt === null) {
      // A run cut short between moving the folder and linking it: the link is still owed.
      if (at === null && (await isRealDir(target))) {
        await fs.mkdir(path.dirname(source), { recursive: true, mode: 0o700 });
        await linkDir(source, target);
      }
      ledger.finish(MOVE, projectId, now());
    }
    return true;
  }
  ledger.begin(MOVE, projectId, now());
  // The levels of a workbench's folders are this user's alone, as the workbench host makes them.
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let kept = await moveHarbor(deps, projectId, source);
  const running = await runningEvaluations(source);
  if (running.length > 0) {
    log(
      `[rsi-workbench] ${projectId}: ${running.join(", ")} ${running.length === 1 ? "has an evaluation" : "have evaluations"} still running; moved all the same, and the old path keeps reaching them through the link`,
    );
  }
  if (kept === 0 && (await lstatOrNull(target)) === null) {
    await moveDir(source, target);
  } else {
    await fs.mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(source)) {
      if (name === HARBOR) continue;
      if ((await lstatOrNull(path.join(target, name))) !== null) {
        kept += 1;
        log(
          `[rsi-workbench] ${projectId}: ${path.join(source, name)} stays where it is: ${path.join(target, name)} already exists. Move one of them by hand; the next start moves the rest.`,
        );
        continue;
      }
      await moveDir(path.join(source, name), path.join(target, name));
    }
    if (kept === 0) await fs.rmdir(source);
  }
  await markSeeded(target, now());
  if (kept > 0) return false;
  await linkDir(source, target);
  ledger.finish(MOVE, projectId, now());
  log(`[rsi-workbench] ${projectId}: moved its Benchmarks to ${target}`);
  return true;
}

/** The Harbor checkout the evaluation Skills kept beside the Benchmarks. */
const HARBOR = ".harbor";

/**
 * Moves `<source>/.harbor/` to the workbench's cache folder, `app/cache/benchmark/harbor/`.
 * Answers 1 when it has to stay (the cache already has a checkout), 0 otherwise.
 */
async function moveHarbor(
  deps: RsiWorkbenchMigrationDeps,
  projectId: string,
  source: string,
): Promise<number> {
  const from = path.join(source, HARBOR);
  if (!(await isRealDir(from))) return 0;
  const to = path.join(
    workbenchCacheDir(deps.root, projectId, DEFAULT_AGENT_ID, WORKBENCH),
    "harbor",
  );
  if ((await lstatOrNull(to)) !== null) {
    deps.log(
      `[rsi-workbench] ${projectId}: ${from} stays where it is: ${to} already exists. Remove one of them by hand; the next start moves the rest.`,
    );
    return 1;
  }
  await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
  await moveDir(from, to);
  return 0;
}

/**
 * The Benchmarks under `source` with an evaluation still running, as the evaluation Skill marks
 * one in a Benchmark's `.jobs/`: the Test Agent's State saved as `<job>.agent-state.tar.gz` while
 * a trial launches, or a trial folder without its `result.json`, which Harbor writes last.
 */
async function runningEvaluations(source: string): Promise<string[]> {
  const entries = async (dir: string) =>
    fs.readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
  const ids: string[] = [];
  for (const bench of await entries(source)) {
    if (!bench.isDirectory() || bench.name.startsWith(".")) continue;
    const jobs = path.join(source, bench.name, ".jobs");
    let running = false;
    for (const job of await entries(jobs)) {
      if (job.isFile() && job.name.endsWith(".agent-state.tar.gz")) running = true;
      else if (job.isDirectory()) {
        for (const trial of await entries(path.join(jobs, job.name))) {
          const result = path.join(jobs, job.name, trial.name, "result.json");
          if (trial.isDirectory() && (await lstatOrNull(result)) === null) running = true;
        }
      }
      if (running) break;
    }
    if (running) ids.push(bench.name);
  }
  return ids;
}

/** Writes the workbench's `.seeded` marker, so its first load leaves the moved Benchmarks alone. */
async function markSeeded(target: string, at: string): Promise<void> {
  await fs
    .writeFile(path.join(target, ".seeded"), `${JSON.stringify({ migratedAt: at }, null, 1)}\n`, {
      flag: "wx",
    })
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));
