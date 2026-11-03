/**
 * Where an Agent's workbenches live and what a folder's revision is.
 *
 *   <agentStateDir>/workbenches/<id>/package.json   `penguin.modules` manifests (a plugin package)
 *   <agentStateDir>/workbenches/<id>/index.ts       default export `{ modules: { <Name>: { create } } }`
 *   <agentStateDir>/workbenches/<id>/ui/            the pages its contributed tabs name
 *   <agentStateDir>/workbenches/<id>/state.json     the workbench's own document (WorkbenchHost.getState)
 *   <agentStateDir>/workbenches/<id>/.harness/      the types it was written against (harness-types.ts)
 *   <agentStateDir>/workbenches/<id>/.build/        its emitted code, per revision (compile.ts)
 *
 * The folder's source is every file except `state.json` (the state is the workbench's data,
 * not its code, and survives a rollback untouched), `node_modules` and the dot entries, which
 * are the server's. Its revision is git's tree id of that source (./repo.ts), so the versions
 * the Agent State repository records carry the same revision. Reading is tolerant: a folder
 * without a package.json is not a workbench.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { blobOid, treeId, type SourceFile } from "./repo.js";

export const STATE_FILE = "state.json";
export const UI_DIR = "ui";

export interface WorkbenchFolder {
  id: string;
  dir: string;
  /** Relative paths, sorted, excluding state.json. */
  files: string[];
  revision: string;
  uiRev: string | null;
  pkg: { name: string; version: string | null };
}

export { workbenchesDir } from "@prismshadow/penguin-core";

/** A workbench id is one path segment of the folder's own name; nothing else is accepted. */
export function isWorkbenchId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && id !== "." && id !== "..";
}

export function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** A name the folder's source can hold: not the server's (dot entries, staged writes), not installed packages. */
function isSourceName(name: string): boolean {
  return name !== "node_modules" && !name.startsWith(".") && !isTempName(name);
}

/** A path inside the folder that is part of its source, and so what a restore may write. */
export function isSourcePath(rel: string): boolean {
  return isSafeRelPath(rel) && rel !== STATE_FILE && rel.split("/").every(isSourceName);
}

async function walk(dir: string, prefix = ""): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!isSourceName(e.name)) continue;
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

async function readFiles(dir: string, files: string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const rel of files) {
    // A file listed a moment ago can be gone by now — an editor's own scratch file, the
    // Agent deleting one mid-write. That is a folder that has changed, not a broken read:
    // what is still there is read, and the watcher brings the next one round.
    try {
      out.push({ rel, body: await fs.readFile(path.join(dir, rel)) });
    } catch {
      continue;
    }
  }
  return out;
}

/** The git tree id of these files: a revision. */
function revisionOf(files: readonly SourceFile[]): string {
  return treeId(files.map((f) => ({ rel: f.rel, oid: blobOid(f.body) })));
}

/** Reads one workbench folder; null when it is not a workbench (no package.json). */
export async function readFolder(dir: string, id: string): Promise<WorkbenchFolder | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
  } catch {
    return null;
  }
  let pkg: { name?: unknown; version?: unknown } = {};
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch {
    // A broken package.json is still a workbench folder: the loader reports the error.
  }
  const files = (await walk(dir)).filter((f) => f !== STATE_FILE);
  const source = await readFiles(dir, files);
  // The pages' revision is the tree id of `ui/` itself.
  const ui = source
    .filter((f) => f.rel.startsWith(`${UI_DIR}/`))
    .map((f) => ({ ...f, rel: f.rel.slice(UI_DIR.length + 1) }));
  return {
    id,
    dir,
    files,
    revision: revisionOf(source),
    uiRev: ui.length === 0 ? null : revisionOf(ui),
    pkg: {
      name: typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : id,
      version: typeof pkg.version === "string" ? pkg.version : null,
    },
  };
}

/** The folder's source files as they are now (a file gone since the folder was read is left out). */
export function readSource(folder: WorkbenchFolder): Promise<SourceFile[]> {
  return readFiles(folder.dir, folder.files);
}

export async function listFolders(base: string): Promise<WorkbenchFolder[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkbenchFolder[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !isWorkbenchId(e.name)) continue;
    const folder = await readFolder(path.join(base, e.name), e.name);
    if (folder) out.push(folder);
  }
  return out;
}

export async function readState(dir: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, STATE_FILE), "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * The suffix every staged write of ours carries. It is what tells the watcher and the
 * revision hash that a file is the server's own scratch and not an edit: a fixed
 * `state.json.tmp` was neither — it reloaded the workbench on every `setState`, and entered
 * the hash it was supposed to be outside of. The random middle keeps two concurrent writes
 * from truncating each other's staging file and renaming a half-written document into place.
 */
export const TMP_SUFFIX = ".penguin-tmp";
export const isTempName = (name: string): boolean => name.includes(TMP_SUFFIX);
const tempPath = (file: string) => `${file}${TMP_SUFFIX}${randomBytes(6).toString("hex")}`;

export async function writeState(dir: string, state: unknown): Promise<void> {
  const file = path.join(dir, STATE_FILE);
  const staged = tempPath(file);
  try {
    await fs.writeFile(staged, JSON.stringify(state ?? null, null, 2));
    await fs.rename(staged, file);
  } catch (err) {
    await fs.rm(staged, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Makes the folder's source exactly `files`: the source files it has and they lack are removed,
 * the rest written. `state.json` and the dot entries are not source and stay as they are; a file
 * outside the source (a version recorded by hand can hold anything) is refused before anything
 * is written.
 */
export async function restoreSource(
  folder: WorkbenchFolder,
  files: readonly SourceFile[],
): Promise<void> {
  const foreign = files.find((f) => !isSourcePath(f.rel));
  if (foreign) throw new Error(`that version holds ${foreign.rel}, which is not workbench source`);
  const keep = new Set(files.map((f) => f.rel));
  for (const rel of folder.files) {
    if (!keep.has(rel)) await fs.rm(path.join(folder.dir, rel), { force: true });
  }
  for (const file of files) {
    const target = path.join(folder.dir, file.rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.body);
  }
}
