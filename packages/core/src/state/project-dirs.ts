/**
 * The Projects a data root holds, read from its folder: every real directory of `projects/` with
 * a `.project_config.toml`, in id order. Whatever walks the Projects on disk (the plugin loader,
 * the config migrations, the resumed Agent deletions, the Trace adoption sweep) lists them here
 * rather than reading a folder of its own.
 *
 * A link is never a Project: the links the layout migration leaves at the Projects' old places
 * (`<root>/<id>`) are not under `projects/`, and a link that someone put under `projects/` is
 * skipped too, so no Project is ever listed twice or reached through another's folder.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import { isValidId } from "./agent-state.js";
import { projectConfigPath, projectDir, projectsDir } from "./paths.js";

/** One Project's folder: its id and where it is. */
export interface ProjectDirEntry {
  id: string;
  dir: string;
}

/** Every Project folder of the data root, sorted by id; empty when `projects/` does not exist. */
export async function listProjectDirs(root: string): Promise<ProjectDirEntry[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir(root), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const found: ProjectDirEntry[] = [];
  for (const entry of entries) {
    // `isDirectory()` is false for a symlink and for a Windows junction: neither is listed.
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    try {
      await fs.access(projectConfigPath(root, entry.name));
    } catch {
      continue;
    }
    found.push({ id: entry.name, dir: projectDir(root, entry.name) });
  }
  return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
