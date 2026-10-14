/**
 * One-time Workflow → Workbench conversion. Originals stay in .workbench-migration/backup;
 * only a fully prepared copy is published. The ready marker makes interrupted renames resumable.
 * Compatibility owner: the Workbench maintainers. Keep through 0.2.x; remove when the minimum
 * supported data version is 0.3 and upgrades from Workflow builds no longer need conversion.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readFolder } from "./store.js";
import type { WorkbenchVersion } from "../mechanisms/workbenches.js";

const pairs = [
  ["workflows", "workbenches"],
  ["workflows-history", "workbenches-history"],
] as const;
const exists = async (file: string) =>
  fs.stat(file).then(
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
  for (const entry of await fs.readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const index = path.join(dir, "versions.json");
    if (!(await exists(index))) continue;
    const versions = JSON.parse(await fs.readFile(index, "utf8")) as WorkbenchVersion[];
    const updated: WorkbenchVersion[] = [];
    // Build beside the old revision directories: hashes can converge after the rename.
    const staged = path.join(dir, ".converted");
    await fs.mkdir(staged);
    for (const version of versions) {
      if (!/^[a-f0-9]{12}$/.test(version.revision))
        throw new Error(`Invalid workbench history revision: ${version.revision}`);
      const source = path.join(dir, version.revision);
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
    await fs.writeFile(index, JSON.stringify(updated, null, 2));
  }
}

export async function migrateWorkbenches(agentDir: string): Promise<void> {
  const journal = path.join(agentDir, ".workbench-migration");
  if (await exists(path.join(journal, "complete"))) return;
  const ready = path.join(journal, "ready");
  if (!(await exists(ready))) {
    if (!(await Promise.all(pairs.map(([old]) => exists(path.join(agentDir, old))))).some(Boolean))
      return;
    // Never merge an independently created Workbench into a converted Workflow with the same id.
    for (const [, current] of pairs) {
      if (await exists(path.join(agentDir, current)))
        throw new Error(
          `Cannot migrate: ${current} already exists in ${agentDir}. Move it aside before retrying; the Workflow files are unchanged.`,
        );
    }
    await fs.rm(journal, { recursive: true, force: true });
    await fs.mkdir(path.join(journal, "staged"), { recursive: true });
    for (const [old, current] of pairs) {
      const source = path.join(agentDir, old);
      if (!(await exists(source))) continue;
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
}
