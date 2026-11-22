/**
 * The seeds a built-in plugin ships for a system app's data (PRFC-0036 `ProjectsModule.appSeeds`),
 * written into a Project when it is created and at no other time.
 *
 * A package declares them as data, `{ app, path }`: every folder under `<package>/<path>/` is one
 * seed, copied under its own name into `AppData.dataPaths(projectId, app).dataDir`. The host reads
 * the declaration from the package's `ifaces.json` and copies the files itself, so nothing of the
 * package runs — at a Project's creation its module may not be loaded yet.
 *
 * WHICH PACKAGES: the ones the new Project lists for this server (its effective plugin table for
 * this machine's id) that are built in — resolved from a prefix the running build ships, and only
 * adding modules (a same-named package under `<root>/plugins` shadows it, and is not built in).
 * A package installed from the market, or linked from a path, seeds nothing.
 *
 * WHEN: once, at creation — the server's Project creation, and the first owner's adoption of
 * `default_project` — and there is no marker: a seed the user deletes does not come back, and a
 * Project created before a package shipped never gets its seeds. A seed whose name is already
 * taken in the data folder is left alone, whatever is there.
 *
 * HOW: each seed is staged under `<dataDir>/.seeding/` and renamed into place (core's
 * placeFolder), so a copy that fails part-way leaves nothing under its name. A seed that cannot
 * be copied is logged and skipped: a broken built-in package must not keep a Project from being
 * created. Links inside a seed are not copied.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isValidId, placeFolder, readPluginTable, slotEntries } from "@prismshadow/penguin-core";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";
import type { Config, Db, Hmr, Log } from "../hmr/capabilities.js";
import {
  PACKAGE_NAME,
  pluginBases,
  readProjectPluginList,
  resolvePluginPackage,
} from "../plugin/loader.js";
import type { PluginBase } from "../plugin/loader.js";
import type { AppData } from "./app-data.js";

/** One package's seeds for one system app. */
export interface AppSeedData {
  /** The system app's id — its page key: the seeds land in that app's data folder. */
  app: string;
  /** A folder inside the package; each folder under it is one seed, copied under its own name. */
  path: string;
}

export interface AppSeedsSlots {
  /** Seeds for a system app's data, copied into a Project when it is created. */
  appSeeds: AppSeedData;
}

/** AppSeeds: what HostAppSeeds implements, and the Project's creation calls. */
@Interface()
export abstract class AppSeeds {
  /** Writes the seeds of every built-in package the new Project lists (see the module header). */
  abstract seedProject(projectId: string): Promise<void>;
}

/** The slot key a package's table names the seeds under. */
export const APP_SEEDS_SLOT = "ProjectsModule.appSeeds";

/** Where seeds are read from and written to, for {@link copyAppSeeds}. */
export interface SeedTarget {
  root: string;
  projectId: string;
  /** This server's own machine id: the `[plugins.<id>]` table that is its own. */
  machineId: string | null;
  bases: readonly PluginBase[];
  /** The data folder of the system app `app` in the Project, made before it is returned. */
  dataDirOf: (app: string) => Promise<string>;
  log: (line: string) => void;
}

/** A relative folder path that stays inside the package on any platform's spelling. */
function insidePackage(rel: string): boolean {
  const normal = path.posix.normalize(rel.replace(/\\/g, "/"));
  return !(
    normal === "." ||
    normal === ".." ||
    normal.startsWith("../") ||
    path.posix.isAbsolute(normal) ||
    /^[A-Za-z]:/.test(normal)
  );
}

/** Copies `from` into `to` (a fresh staging folder), leaving out every link. */
async function copyWithoutLinks(from: string, to: string): Promise<void> {
  await fs.cp(from, to, {
    recursive: true,
    errorOnExist: false,
    filter: async (source) => !(await fs.lstat(source)).isSymbolicLink(),
  });
}

/** One package's declared seeds, each checked; what does not read is logged and left out. */
function seedsOf(pkg: string, dir: string, log: (line: string) => void): AppSeedData[] {
  let table: ReturnType<typeof readPluginTable>;
  try {
    table = readPluginTable(dir);
  } catch (err) {
    log(
      `[app-seeds] ${pkg}: its table does not read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  // A stand-in for a platform node is no built-in module (PRFC-0031).
  if (table === null || table.plugin.replaces.length > 0) return [];
  const out: AppSeedData[] = [];
  for (const { at, entry } of slotEntries(table, APP_SEEDS_SLOT)) {
    const { app, path: rel } = entry;
    if (typeof app !== "string" || !isValidId(app)) {
      log(`[app-seeds] ${pkg}: ${at}.app is not an app id; ignored`);
      continue;
    }
    if (typeof rel !== "string" || !insidePackage(rel)) {
      log(`[app-seeds] ${pkg}: ${at}.path must name a folder inside the package; ignored`);
      continue;
    }
    out.push({ app, path: rel });
  }
  return out;
}

/** Whether anything is under `p`, a link included. */
async function occupied(p: string): Promise<boolean> {
  return fs.lstat(p).then(
    () => true,
    () => false,
  );
}

/** Writes one package's seeds for one app: each folder not yet under its name in the data folder. */
async function copySeeds(
  pkg: string,
  packageDir: string,
  seed: AppSeedData,
  target: SeedTarget,
): Promise<void> {
  const from = path.join(packageDir, seed.path);
  // The seeds folder itself must be the package's own, not a link out of it.
  const real = await fs.realpath(from).catch(() => null);
  const realPackage = await fs.realpath(packageDir);
  if (real === null || !real.startsWith(realPackage + path.sep)) {
    target.log(`[app-seeds] ${pkg}: ${seed.path} is not a folder of the package; ignored`);
    return;
  }
  const entries = await fs.readdir(real, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory() && isValidId(e.name));
  if (folders.length === 0) return;
  const dataDir = await target.dataDirOf(seed.app);
  for (const folder of folders) {
    if (await occupied(path.join(dataDir, folder.name))) continue;
    try {
      await placeFolder(dataDir, folder.name, (into) =>
        copyWithoutLinks(path.join(real, folder.name), into),
      );
    } catch (err) {
      target.log(
        `[app-seeds] ${pkg}: seed ${seed.app}/${folder.name} not written: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Writes the seeds of every built-in package `target.projectId` lists (see the module header). */
export async function copyAppSeeds(target: SeedTarget): Promise<void> {
  const listed = await readProjectPluginList(target.root, target.projectId, target.machineId);
  for (const pkg of listed) {
    // A path names a checkout, never a package the build ships.
    if (!PACKAGE_NAME.test(pkg)) continue;
    const found = resolvePluginPackage(pkg, target.bases);
    if (found === null || !found.base.builtin) continue;
    for (const seed of seedsOf(pkg, found.dir, target.log)) {
      try {
        await copySeeds(pkg, found.dir, seed, target);
      } catch (err) {
        target.log(
          `[app-seeds] ${pkg}: seeds for ${seed.app} not written: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

@Component()
export class HostAppSeeds implements AppSeeds {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly db!: Db;
  @Use() private readonly log!: Log;
  @Use() private readonly appData!: AppData;

  async seedProject(projectId: string): Promise<void> {
    const log = (line: string) => this.log.line(line);
    try {
      await copyAppSeeds({
        root: this.config.root,
        projectId,
        machineId: new MachinesRepo(this.db as unknown as DatabaseSync).ownId(),
        bases: pluginBases(this.config.root, this.hmr.assetsDir()),
        dataDirOf: async (app) => (await this.appData.dataPaths(projectId, app)).dataDir,
        log,
      });
    } catch (err) {
      // The Project exists by now: a seed it could not get is logged, never its creation's failure.
      log(`[app-seeds] ${projectId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
