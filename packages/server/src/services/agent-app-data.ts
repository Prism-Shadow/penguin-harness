/**
 * A workbench's data folder in an Agent package. The folder lives beside the Agent State, not in
 * it (`<agentDir>/app/data/<workbenchId>/`, core's `workbenchDataDir`), so the package carries it
 * at the same place below the Agent's directory: `<agentId>/app/data/<workbenchId>/…`.
 *
 * It is the workbench's data, as `state.json` is: an export carries it only with
 * `workbenchData`, and only for a workbench it carries; the cache folder never travels. An
 * overwrite import replaces the folder of each workbench the package brings data for, keeps the
 * folder of a workbench it brings none for, and removes the data and cache of a workbench the
 * new State no longer has — that workbench is gone, as its `state.json` is. The backup the
 * import takes first holds every folder it replaces or removes.
 *
 * Nothing here follows a link: a link on the way to a folder on disk leaves the folder out of
 * an export and refuses an import, and a package that holds a link below `app/` is refused.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir, workbenchCacheDir, workbenchDataDir } from "@prismshadow/penguin-core";
import { badRequest } from "../http/errors.js";
import { realDirs, removeBelow, WorkbenchFileError } from "../workbenches/files.js";
import { isTempName, isWorkbenchId } from "../workbenches/store.js";
import { APP_DATA } from "./agent-zip.js";

/** The workbench folders directly below `dir` (an Agent State's `workbenches/`). */
async function workbenchIds(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
  return entries.filter((e) => e.isDirectory() && isWorkbenchId(e.name)).map((e) => e.name);
}

/** The data folder's segments below the Agent's directory: `app`, `data`, `<id>`. */
function chainOf(root: string, projectId: string, agentId: string, id: string): string[] {
  return path
    .relative(agentDir(root, projectId, agentId), workbenchDataDir(root, projectId, agentId, id))
    .split(path.sep);
}

/**
 * Hands `add` every regular file of the data folders of `ids`, named as the package names it
 * (`app/data/<id>/…`), but those `skip` names. A folder with a link on the way is left out; a
 * link inside is skipped.
 */
export async function collectAppData(
  root: string,
  projectId: string,
  agentId: string,
  ids: readonly string[],
  skip: (name: string) => boolean,
  add: (name: string, data: Uint8Array) => void,
): Promise<void> {
  const base = agentDir(root, projectId, agentId);
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (isTempName(entry.name) || skip(child)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), child);
      else if (entry.isFile()) add(child, await fs.readFile(path.join(dir, entry.name)));
    }
  };
  for (const id of ids) {
    const chain = chainOf(root, projectId, agentId, id);
    if (await realDirs(base, chain, "export").catch(() => false)) {
      await walk(path.join(base, ...chain), chain.join("/"));
    }
  }
}

/** A package path below `dir` that is a link, or null: the unpack puts a tar's links on disk. */
async function firstLink(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return full;
    if (entry.isDirectory()) {
      const inner = await firstLink(full);
      if (inner !== null) return inner;
    }
  }
  return null;
}

/**
 * The data side of one import: `extractDir` is the unpacked package, `stateDir` the Agent State
 * it replaces. Built before the backup, so a refusal changes nothing.
 */
export class AppDataImport {
  private constructor(
    private readonly base: string,
    private readonly extractDir: string,
    /** Workbenches the package brings data for: their folders are replaced. */
    private readonly replaced: string[],
    /** Workbenches the new State no longer has: their data and cache go. */
    private readonly dropped: string[],
    private readonly dataDir: (id: string) => string,
    private readonly cacheDir: (id: string) => string,
  ) {}

  /**
   * Reads what the import will do. `incomingState` is the package's `agent_state/` as it will
   * be swapped in (the parts it left out already copied over).
   */
  static async prepare(
    root: string,
    projectId: string,
    agentId: string,
    extractDir: string,
    incomingState: string,
    stateDir: string,
  ): Promise<AppDataImport> {
    const link = await firstLink(path.join(extractDir, APP_DATA[0]));
    if (link !== null) {
      const name = path.relative(extractDir, link).replaceAll("\\", "/");
      throw badRequest(`Import failed: the package holds a link: ${name}`);
    }
    const base = agentDir(root, projectId, agentId);
    try {
      await realDirs(base, APP_DATA, "import");
    } catch (err) {
      if (err instanceof WorkbenchFileError) throw badRequest(`Import failed: ${err.message}`);
      throw err;
    }
    const incoming = new Set(await workbenchIds(path.join(incomingState, "workbenches")));
    const carried = await workbenchIds(path.join(extractDir, ...APP_DATA));
    const current = await workbenchIds(path.join(stateDir, "workbenches"));
    return new AppDataImport(
      base,
      extractDir,
      carried.filter((id) => incoming.has(id)),
      current.filter((id) => !incoming.has(id)),
      (id) => workbenchDataDir(root, projectId, agentId, id),
      (id) => workbenchCacheDir(root, projectId, agentId, id),
    );
  }

  /** What the backup must hold besides `agent_state`: the data folders this replaces or removes. */
  async backupPaths(): Promise<string[]> {
    const out: string[] = [];
    for (const id of [...this.replaced, ...this.dropped]) {
      const chain = path.relative(this.base, this.dataDir(id)).split(path.sep);
      if (await realDirs(this.base, chain, "import").catch(() => false)) out.push(chain.join("/"));
    }
    return out;
  }

  /**
   * After the State swap: each carried folder moves in over the current one (moved into
   * `trash`, which the caller removes with its staging), and the cache of a replaced or dropped
   * workbench goes with the data of a dropped one.
   */
  async land(trash: string): Promise<void> {
    for (const id of this.replaced) {
      const target = this.dataDir(id);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if ((await fs.lstat(target).catch(() => null)) !== null) {
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(target, path.join(trash, id));
      }
      await fs.rename(path.join(this.extractDir, ...APP_DATA, id), target);
    }
    for (const id of this.dropped) await removeBelow(this.base, this.dataDir(id));
    for (const id of [...this.replaced, ...this.dropped]) {
      await removeBelow(this.base, this.cacheDir(id));
    }
  }
}
