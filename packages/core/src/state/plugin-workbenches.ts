/** Workbench payloads use the same plugin install path as Skills; runtime state is never payload. */
import fs from "node:fs/promises";
import path from "node:path";
import type { LibraryPlugin } from "../plugins/index.js";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { agentDir } from "./paths.js";

export interface InstalledWorkbench {
  name: string;
  plugin: string;
  version: string;
}
interface Receipt extends InstalledWorkbench {
  files: string[];
}
const receiptFile = ".plugin.json";
const safeSource = (rel: string): boolean =>
  rel !== "state.json" &&
  !path.isAbsolute(rel) &&
  !rel.includes("\\") &&
  rel.split("/").every((part) => part !== "" && !part.startsWith(".") && part !== "node_modules");
const baseDir = (root: string, project: string, agent: string) =>
  path.join(agentDir(root, project, agent), "workbenches");
async function receipt(dir: string): Promise<Receipt | null> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(dir, receiptFile), "utf8"));
    if (
      data === null ||
      typeof data !== "object" ||
      typeof data.plugin !== "string" ||
      typeof data.version !== "string" ||
      !Array.isArray(data.files) ||
      !data.files.every((file: unknown) => typeof file === "string" && safeSource(file))
    )
      return null;
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
      return null;
    throw error;
  }
}
export async function listInstalledWorkbenches(
  root: string,
  project: string,
  agent: string,
): Promise<InstalledWorkbench[]> {
  const base = baseDir(root, project, agent);
  let dirs;
  try {
    dirs = await fs.readdir(base, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const installed: InstalledWorkbench[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const item = await receipt(path.join(base, dir.name));
    if (!item) continue;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(base, dir.name, "package.json"), "utf8"));
      // Rollback restores package.json, but ownership stays with the plugin. Read the code's
      // version so an older restored revision can be offered the current library update.
      const version =
        item.version === ""
          ? ""
          : typeof pkg.penguin?.version === "string"
            ? pkg.penguin.version
            : "";
      installed.push({ name: dir.name, plugin: item.plugin, version });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
  }
  return installed.sort((a, b) => a.name.localeCompare(b.name));
}
export class WorkbenchNameTakenError extends Error {
  constructor(name: string) {
    super(
      `Workbench '${name}' already exists and belongs to another plugin or was created by hand. Rename or remove it first. Nothing was installed.`,
    );
    this.name = "WorkbenchNameTakenError";
  }
}
/** Check the whole request before writing any Skill, config or workbench. */
export async function assertPluginWorkbenchesInstallable(
  root: string,
  project: string,
  agent: string,
  plugins: readonly LibraryPlugin[],
): Promise<void> {
  const seen = new Map<string, string>();
  for (const plugin of plugins)
    for (const workbench of plugin.workbenches ?? []) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(workbench.name) ||
        Object.keys(workbench.files).some((file) => !safeSource(file))
      )
        throw new Error("Invalid workbench payload");
      const dir = path.join(baseDir(root, project, agent), workbench.name);
      const owner = seen.get(workbench.name);
      if (owner && owner !== plugin.name) throw new WorkbenchNameTakenError(workbench.name);
      seen.set(workbench.name, plugin.name);
      const existing = await fs.lstat(dir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing) {
        if (!existing.isDirectory()) throw new WorkbenchNameTakenError(workbench.name);
        const current = await receipt(dir);
        // A folder holding only state can precede provisioning (restored data); source is never adopted silently.
        const contents = await fs.readdir(dir);
        if (current?.plugin !== plugin.name && contents.some((name) => name !== "state.json"))
          throw new WorkbenchNameTakenError(workbench.name);
      }
    }
}
/** Writes source atomically per file, with the receipt last; state and history stay in place. */
export async function installPluginWorkbenches(
  root: string,
  project: string,
  agent: string,
  plugin: LibraryPlugin,
): Promise<void> {
  for (const workbench of plugin.workbenches ?? []) {
    const dir = path.join(baseDir(root, project, agent), workbench.name);
    const previous = await receipt(dir);
    await fs.mkdir(dir, { recursive: true });
    // Claim before writing source so a failed first install can be retried. Empty version stays outdated.
    await atomicWriteFile(
      path.join(dir, receiptFile),
      JSON.stringify({
        name: workbench.name,
        plugin: plugin.name,
        version: "",
        files: [...new Set([...(previous?.files ?? []), ...Object.keys(workbench.files)])],
      } satisfies Receipt),
    );
    for (const [rel, content] of Object.entries(workbench.files)) {
      // Refuse symlink parents: an editable workbench must not redirect an update outside its folder.
      let parent = dir;
      for (const part of rel.split("/").slice(0, -1)) {
        parent = path.join(parent, part);
        await fs.mkdir(parent, { recursive: true });
        if ((await fs.lstat(parent)).isSymbolicLink())
          throw new Error(`Workbench source directory is a symlink: ${rel}`);
      }
      await atomicWriteFile(path.join(dir, rel), content);
    }
    for (const rel of previous?.files ?? []) {
      if (!(rel in workbench.files)) {
        let parent = dir;
        for (const part of rel.split("/").slice(0, -1)) {
          parent = path.join(parent, part);
          if ((await fs.lstat(parent).catch(() => null))?.isSymbolicLink())
            throw new Error(`Workbench source directory is a symlink: ${rel}`);
        }
        await fs.rm(path.join(dir, rel), { force: true });
      }
    }
    // A library update replaces the authored source, so check it against this host's types
    // on its next load. Hand-authored workbenches keep their authoring contract unchanged.
    await fs.rm(path.join(dir, ".harness"), { recursive: true, force: true });
    await atomicWriteFile(
      path.join(dir, receiptFile),
      JSON.stringify({
        name: workbench.name,
        plugin: plugin.name,
        version: workbench.version,
        files: Object.keys(workbench.files),
      } satisfies Receipt),
    );
  }
}
