/**
 * Where an Agent's workflows live and how their versions are kept.
 *
 *   <agentDir>/workflows/<id>/package.json   `penguin.modules` manifests (a plugin package)
 *   <agentDir>/workflows/<id>/index.mjs      default export `{ modules: { <Name>: { create } } }`
 *   <agentDir>/workflows/<id>/ui/            optional static UI, served as the workflow's tab
 *   <agentDir>/workflows/<id>/state.json     the workflow's own document (WorkflowHost.getState)
 *   <agentDir>/workflows-history/<id>/<revision>/   a full copy of the folder at each successful load
 *   <agentDir>/workflows-history/<id>/versions.json  the list, newest first
 *
 * The revision is the content hash of every file except `state.json` (the state is the
 * workflow's data, not its code, and survives a rollback untouched). Reading is tolerant:
 * a folder without a package.json is not a workflow, a broken versions.json is an empty list.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir } from "@prismshadow/penguin-core";
import type { WorkflowVersion } from "../mechanisms/workflows.js";

export const STATE_FILE = "state.json";
export const UI_DIR = "ui";
/** Versions kept per workflow; older copies are removed with their folders. */
export const KEEP_VERSIONS = 20;

export interface WorkflowFolder {
  id: string;
  dir: string;
  /** Relative paths, sorted, excluding state.json. */
  files: string[];
  revision: string;
  uiRev: string | null;
  pkg: { name: string; version: string | null };
}

export function workflowsDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "workflows");
}

export function historyDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "workflows-history");
}

/** A workflow id is one path segment of the folder's own name; nothing else is accepted. */
export function isWorkflowId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && id !== "." && id !== "..";
}

export function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
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
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

async function hashFiles(dir: string, files: string[]): Promise<string> {
  const h = createHash("sha256");
  for (const rel of files) {
    h.update(rel).update("\0");
    h.update(await fs.readFile(path.join(dir, rel))).update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

/** Reads one workflow folder; null when it is not a workflow (no package.json). */
export async function readFolder(dir: string, id: string): Promise<WorkflowFolder | null> {
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
    // A broken package.json is still a workflow folder: the loader reports the error.
  }
  const files = (await walk(dir)).filter((f) => f !== STATE_FILE);
  const ui = files.filter((f) => f.startsWith(`${UI_DIR}/`));
  return {
    id,
    dir,
    files,
    revision: await hashFiles(dir, files),
    uiRev: ui.length === 0 ? null : await hashFiles(dir, ui),
    pkg: {
      name: typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : id,
      version: typeof pkg.version === "string" ? pkg.version : null,
    },
  };
}

export async function listFolders(base: string): Promise<WorkflowFolder[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkflowFolder[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !isWorkflowId(e.name)) continue;
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

export async function writeState(dir: string, state: unknown): Promise<void> {
  const file = path.join(dir, STATE_FILE);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(state ?? null, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

async function readVersions(dir: string): Promise<WorkflowVersion[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "versions.json"), "utf8"));
    return Array.isArray(parsed) ? (parsed as WorkflowVersion[]) : [];
  } catch {
    return [];
  }
}

async function writeVersions(dir: string, versions: WorkflowVersion[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "versions.json");
  await fs.writeFile(`${file}.tmp`, JSON.stringify(versions, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/**
 * Records the folder's current content as a version (no-op when that revision is already
 * the newest), copying the files and trimming to KEEP_VERSIONS.
 */
export async function recordVersion(
  history: string,
  folder: WorkflowFolder,
  now: Date,
): Promise<WorkflowVersion[]> {
  const dir = path.join(history, folder.id);
  const versions = await readVersions(dir);
  if (versions[0]?.revision === folder.revision) return versions;
  const target = path.join(dir, folder.revision);
  await fs.rm(target, { recursive: true, force: true });
  for (const rel of folder.files) {
    await fs.mkdir(path.dirname(path.join(target, rel)), { recursive: true });
    await fs.copyFile(path.join(folder.dir, rel), path.join(target, rel));
  }
  const entry: WorkflowVersion = {
    revision: folder.revision,
    savedAt: now.toISOString(),
    name: folder.pkg.name,
    version: folder.pkg.version,
    uiRev: folder.uiRev,
    files: folder.files,
  };
  // A revision seen before moves to the front rather than duplicating (a rollback IS such a load).
  const next = [entry, ...versions.filter((v) => v.revision !== folder.revision)];
  for (const old of next.splice(KEEP_VERSIONS)) {
    await fs.rm(path.join(dir, old.revision), { recursive: true, force: true });
  }
  await writeVersions(dir, next);
  return next;
}

export function listVersions(history: string, id: string): Promise<WorkflowVersion[]> {
  return readVersions(path.join(history, id));
}

/**
 * Replaces the folder's code files with a recorded version's, keeping state.json. Files
 * the current folder has and the version lacks are removed, so the result is exactly that
 * version. Returns false when the version is not recorded.
 */
export async function restoreVersion(
  history: string,
  folder: WorkflowFolder,
  revision: string,
): Promise<boolean> {
  const versions = await readVersions(path.join(history, folder.id));
  const version = versions.find((v) => v.revision === revision);
  if (!version) return false;
  const source = path.join(history, folder.id, revision);
  const keep = new Set(version.files);
  for (const rel of folder.files) {
    if (!keep.has(rel)) await fs.rm(path.join(folder.dir, rel), { force: true });
  }
  for (const rel of version.files) {
    await fs.mkdir(path.dirname(path.join(folder.dir, rel)), { recursive: true });
    await fs.copyFile(path.join(source, rel), path.join(folder.dir, rel));
  }
  return true;
}
