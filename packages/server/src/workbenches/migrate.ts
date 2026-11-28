/**
 * One-time Workflow → Workbench conversion. Originals stay in .workbench-migration/backup;
 * only a fully prepared copy is published. The ready marker makes interrupted renames resumable.
 * Compatibility owner: the Workbench maintainers. Keep through 0.2.x; remove when the minimum
 * supported data version is 0.3 and upgrades from Workflow builds no longer need conversion.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { GitEngine } from "@prismshadow/penguin-core/plugin";
import { migrateWorkbenchesIntoState } from "./migrate-state.js";
import { readFolder } from "./store.js";

/** An entry of a Workflow-era `versions.json`. */
interface LegacyVersion {
  revision: string;
  uiRev?: string | null;
  files?: string[];
}

const pairs = [
  ["workflows", "workbenches"],
  ["workflows-history", "workbenches-history"],
] as const;
const exists = async (file: string) =>
  fs.lstat(file).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );

/** Rename the public contract, not arbitrary user data or workbench ids. */
function convert(text: string): string {
  return text
    .replace(/\bWorkflow(?=[A-Z]|\b)/g, "Workbench")
    .replace(/workflows-history\//g, "workbenches-history/")
    .replace(/workflows\//g, "workbenches/")
    .replace(/\/workflows(?=[/"'`?])/g, "/workbenches")
    .replace(/workflow-ui\.css/g, "workbench-ui.css")
    .replace(/--wf-/g, "--wb-")
    .replace(/\bwf-(primary|card|rows|row|muted)\b/g, "wb-$1");
}

async function convertTree(dir: string): Promise<void> {
  const rootStat = await fs.lstat(dir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || entry.name === "node_modules" || entry.name === "state.json")
      continue;
    if (entry.name === ".build") {
      await fs.rm(file, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await convertTree(file);
    } else if (
      /\.(?:[cm]?[jt]sx?|html?|css)$/.test(entry.name) ||
      entry.name === "package.json" ||
      (path.basename(dir) === ".harness" && entry.name === "ifaces.json")
    ) {
      const original = await fs.readFile(file, "utf8");
      const converted = convert(original);
      if (original !== converted) await fs.writeFile(file, converted);
    }
  }
}

async function convertHistory(base: string): Promise<void> {
  const baseStat = await fs.lstat(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new Error(`Cannot migrate history: ${base} is a symbolic link or not a directory.`);
  }
  for (const entry of await fs.readdir(base, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const index = path.join(dir, "versions.json");
    let indexStat: import("node:fs").Stats;
    try {
      indexStat = await fs.lstat(index);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (indexStat.isSymbolicLink() || !indexStat.isFile()) {
      throw new Error(`Cannot migrate history: ${index} is a symbolic link or not a regular file.`);
    }
    const versions = JSON.parse(await fs.readFile(index, "utf8")) as LegacyVersion[];
    const updated: LegacyVersion[] = [];
    // Build beside the old revision directories: hashes can converge after the rename.
    const staged = path.join(dir, ".converted");
    await fs.mkdir(staged);
    for (const version of versions) {
      if (!/^[a-f0-9]{12}$/.test(version.revision))
        throw new Error(`Invalid workbench history revision: ${version.revision}`);
      const source = path.join(dir, version.revision);
      const sourceStat = await fs.lstat(source).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (!sourceStat) throw new Error(`Missing workbench history: ${source}`);
      if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
        throw new Error(
          `Cannot migrate history: ${source} is a symbolic link or not a real directory.`,
        );
      }
      const folder = await readFolder(source, entry.name);
      if (!folder) throw new Error(`Missing workbench history: ${source}`);
      if (updated.some((v) => v.revision === folder.revision)) continue;
      await fs.cp(source, path.join(staged, folder.revision), { recursive: true });
      updated.push({
        ...version,
        revision: folder.revision,
        uiRev: folder.uiRev,
        files: folder.files,
      });
    }
    for (const version of versions)
      await fs.rm(path.join(dir, version.revision), { recursive: true, force: true });
    for (const revision of await fs.readdir(staged))
      await fs.rename(path.join(staged, revision), path.join(dir, revision));
    await fs.rmdir(staged);
    const tmpIndex = path.join(dir, `.versions.json.penguin-tmp-${process.pid}-${Date.now()}`);
    await fs.writeFile(tmpIndex, JSON.stringify(updated, null, 2));
    await fs.rename(tmpIndex, index);
  }
}

/** The run in flight per Agent directory: every caller for one Agent awaits the same run. */
const running = new Map<string, Promise<void>>();
/** Per-Agent-dir hold gate preventing direct migrations from racing with archive swaps (Major #3). */
const migrationHeld = new Map<string, Promise<void>>();

/**
 * Prevents `migrateWorkbenches(agentDir, ...)` from starting while `work` runs (e.g. an Agent
 * State archive swap) and drains any already-running migration for `agentDir` first.
 */
export async function whileAgentMigrationHeld<T>(
  agentDir: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(agentDir);
  for (let h = migrationHeld.get(key); h; h = migrationHeld.get(key)) await h;
  let release!: () => void;
  migrationHeld.set(key, new Promise<void>((r) => (release = r)));
  try {
    const active = running.get(key);
    if (active) await active.catch(() => undefined);
    return await work();
  } finally {
    migrationHeld.delete(key);
    release();
  }
}

/**
 * Every one-time step an Agent's workbenches need, in order: the Workflow conversion, then the
 * move into Agent State (./migrate-state.ts). Any caller may await it before touching the
 * workbenches, concurrently with others.
 */
export async function migrateWorkbenches(
  agentDir: string,
  engine: GitEngine | (() => GitEngine),
): Promise<void> {
  const key = path.resolve(agentDir);
  for (let h = migrationHeld.get(key); h; h = migrationHeld.get(key)) await h;
  const inFlight = running.get(key);
  if (inFlight) return inFlight;
  const run = (async () => {
    // What the conversion has just published, the server wrote: no Agent is writing it.
    const converted = await convertWorkflows(agentDir);
    await migrateWorkbenchesIntoState(agentDir, { settled: converted, engine });
  })().finally(() => running.delete(key));
  running.set(key, run);
  return run;
}

/** True when this call published the converted folders. */
export async function convertWorkflows(agentDir: string): Promise<boolean> {
  const journal = path.join(agentDir, ".workbench-migration");
  if (await exists(path.join(journal, "complete"))) return false;
  const ready = path.join(journal, "ready");
  if (!(await exists(ready))) {
    if (!(await Promise.all(pairs.map(([old]) => exists(path.join(agentDir, old))))).some(Boolean))
      return false;
    // Never merge an independently created Workbench into a converted Workflow with the same id.
    for (const [, current] of pairs) {
      if (await exists(path.join(agentDir, current)))
        throw new Error(
          `Cannot migrate: ${current} already exists in ${agentDir}. Move it aside before retrying; the Workflow files are unchanged.`,
        );
    }
    // Only this conversion's own leftovers: the journal also keeps later steps' backups.
    await fs.rm(path.join(journal, "staged"), { recursive: true, force: true });
    await fs.mkdir(path.join(journal, "staged"), { recursive: true });
    for (const [old, current] of pairs) {
      const source = path.join(agentDir, old);
      let sourceStat: import("node:fs").Stats;
      try {
        sourceStat = await fs.lstat(source);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
        throw new Error(
          `Cannot migrate: ${source} is a symbolic link or not a real directory. Replace it with a real directory before retrying; the original files are unchanged.`,
        );
      }
      const target = path.join(journal, "staged", current);
      await fs.cp(source, target, { recursive: true });
      await convertTree(target);
      if (current === "workbenches-history") await convertHistory(target);
    }
    await fs.writeFile(ready, "1\n");
  }
  await fs.mkdir(path.join(journal, "backup"), { recursive: true });
  for (const [old, current] of pairs) {
    const source = path.join(agentDir, old);
    const backup = path.join(journal, "backup", old);
    const staged = path.join(journal, "staged", current);
    const target = path.join(agentDir, current);
    if (await exists(source)) {
      if (await exists(backup)) throw new Error(`Migration backup already exists: ${backup}`);
      await fs.rename(source, backup);
    }
    if (await exists(staged)) {
      if (await exists(target)) throw new Error(`Migration destination already exists: ${target}`);
      await fs.rename(staged, target);
    }
  }
  await fs.writeFile(path.join(journal, "complete"), "1\n");
  return true;
}
