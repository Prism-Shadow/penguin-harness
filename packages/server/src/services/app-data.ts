/**
 * A system app's own folders in a Project (PRFC-0036 `AppData`): the system Agent's agent-level
 * folders of PRFC-0032, keyed by the app's id — the page key of the system app a server module
 * contributes —
 *
 *   dataDir   <root>/<p>/agents/system_agent/app/data/<appId>/
 *   cacheDir  <root>/<p>/agents/system_agent/app/cache/<appId>/
 *   stateDir  <root>/run/<h(p)>/<h(system_agent)>/<h(appId)>/
 *
 * The system Agent is never deleted or exported, so these folders live exactly as long as the
 * Project. They are made before their paths are handed out (one real directory per level, this
 * user's only, a link where a level belongs refused: workbenches/data-dirs.ts), and a handler
 * then reads and writes them with Node's own `fs`.
 *
 * Two answers are this host's alone, and no plugin computes them:
 *
 * - **The Evaluation Center's data** (`appId` `benchmark`) is the folder the Project's Benchmarks
 *   are in, core's `benchmarksDir`: `<p>/benchmarks/` until the data-root layout (PRFC-0034)
 *   moves them into the system Agent's `app/data/benchmark/` and re-points that function. A
 *   Project whose `system_agent` is an Agent of the user's (compat C1, core state/system-agent.ts)
 *   keeps its Benchmarks at the old place, which PRFC-0034's rule names there too; that app's
 *   cache then sits in its state folder, outside the user's Agent. The case goes with compat C1,
 *   at 1.0.
 * - **A Project whose `system_agent` is an Agent of the user's** has no system Agent, so it has no
 *   folders for any other app: the call is refused 409 `system_agent_held` rather than writing a
 *   platform app's files into the user's own Agent, whose export would carry them.
 *
 * A Project created before the system Agent existed is given it here first, as its first listing
 * would (core's `provisionSystemAgent`): the folders belong under it, and making
 * `agents/system_agent/` by hand would leave a folder the provisioning then takes for a user's.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  benchmarksDir,
  isSystemAgent,
  isValidId,
  projectDir,
  provisionSystemAgent,
  SYSTEM_AGENT_ID,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Projects } from "@prismshadow/penguin-library-project";
import type { Paths } from "../hmr/capabilities.js";
import { badRequest, HttpError } from "../http/errors.js";
import { ensureDir, levelFolders } from "../workbenches/data-dirs.js";

/** One system app's three folders in a Project: kept for good, made again at will, sockets and locks. */
export interface AppDataPaths {
  dataDir: string;
  cacheDir: string;
  stateDir: string;
}

/** AppData: what SystemAgentAppData implements, and a server module reaches through the plugin face. */
@Interface()
export abstract class AppData {
  /**
   * The folders of the system app `appId` in the Project `projectId`, each made before it is
   * returned. 400 for an id that is not one plain segment, 404 `project_not_found` for a Project
   * this server does not have, 409 `system_agent_held` where the Project's `system_agent` is the
   * user's own Agent (see the module header). Callers check the caller's access to the Project
   * first; this does not.
   */
  abstract dataPaths(projectId: string, appId: string): Promise<AppDataPaths>;
}

/** The Evaluation Center's app id: its page key, and the folder name PRFC-0034 gives its data. */
export const BENCHMARK_APP_ID = "benchmark";

/** Where an Agent of the user's holds the system Agent's id: its config is there without the key. */
async function heldByUsersAgent(root: string, projectId: string): Promise<boolean> {
  if (await isSystemAgent(root, projectId, SYSTEM_AGENT_ID)) return false;
  const held = await fs
    .access(systemConfigPath(root, projectId, SYSTEM_AGENT_ID))
    .then(() => true)
    .catch(() => false);
  // Not held: the Project predates the system Agent. Provisioned where the id is free; a write
  // that finds an Agent already there only loads it, and answers whether it is the system Agent.
  return held || !(await provisionSystemAgent({ root, projectId }));
}

@Component()
export class SystemAgentAppData implements AppData {
  @Use() private readonly paths!: Paths;
  @Use() private readonly projects!: Projects;

  async dataPaths(projectId: string, appId: string): Promise<AppDataPaths> {
    for (const [name, id] of [
      ["projectId", projectId],
      ["appId", appId],
    ] as const) {
      if (typeof id !== "string" || !isValidId(id)) {
        throw badRequest(`${name} must be letters, digits, '_' and '-' only.`);
      }
    }
    if (this.projects.findById(projectId) === null) {
      throw new HttpError(404, "project_not_found", "Project does not exist.");
    }
    const root = this.paths.root;
    const held = await heldByUsersAgent(root, projectId);
    if (held && appId !== BENCHMARK_APP_ID) {
      throw new HttpError(
        409,
        "system_agent_held",
        `This Project's ${SYSTEM_AGENT_ID} is an Agent of yours, so it has no system Agent to keep the ${appId} app's files: move that Agent to another id first.`,
      );
    }
    const { paths, bases } = levelFolders(
      "agent",
      { root, projectId, agentId: SYSTEM_AGENT_ID, workbenchId: appId, plugin: null },
      "dataPaths",
    );
    ensureDir(bases.stateDir, paths.stateDir, "dataPaths");
    if (appId === BENCHMARK_APP_ID) {
      // The Benchmarks' own folder (see the module header). Where the id is the user's Agent,
      // nothing of the app goes into that Agent's folder: its cache sits in its state folder.
      const dataDir = benchmarksDir(root, projectId);
      ensureDir(projectDir(root, projectId), dataDir, "dataPaths");
      if (held) {
        const cacheDir = path.join(paths.stateDir, "cache");
        ensureDir(paths.stateDir, cacheDir, "dataPaths");
        return { dataDir, cacheDir, stateDir: paths.stateDir };
      }
      ensureDir(bases.cacheDir, paths.cacheDir, "dataPaths");
      return { dataDir, cacheDir: paths.cacheDir, stateDir: paths.stateDir };
    }
    ensureDir(bases.dataDir, paths.dataDir, "dataPaths");
    ensureDir(bases.cacheDir, paths.cacheDir, "dataPaths");
    return paths;
  }
}
