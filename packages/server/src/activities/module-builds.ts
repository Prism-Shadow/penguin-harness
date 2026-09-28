/**
 * An activity's module builds: which one the preview plays, the source files a build holds,
 * and what differs between two builds.
 *
 * A build is the `module` folder of a succeeded assembly run's workspace. Only its sources
 * count: installed packages, compiled output and version control are left out, as the
 * preview's module files leave them out.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ActivityRunSummary } from "./domain.js";
import type { ModuleBuildDiff, ModuleBuildFileDiff } from "./module-build-types.js";

/** Folders a build's files never come from. */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".typescript-build"]);

/** Files a compare shows as text. */
const TEXT_EXTENSIONS = new Set([".js", ".ts", ".json", ".css", ".scss", ".html"]);

/** The largest file a compare shows as text. */
export const BUILD_TEXT_MAX = 200 * 1024;

/** The most text one compare returns; files past it are listed without their text. */
const DIFF_TEXT_BUDGET = 8 * 1024 * 1024;

/** The most files a build is read for; a folder past it is not a module's sources. */
const FILES_MAX = 10_000;

type RunLike = Pick<ActivityRunSummary, "runId" | "kind" | "status" | "createdAt">;

/** Succeeded module runs, newest first. */
export function succeededBuilds<T extends RunLike>(runs: readonly T[]): T[] {
  return runs
    .filter((run) => run.kind === "module" && run.status === "succeeded")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * The build the preview plays: the pinned run while it is still a succeeded module run of
 * the activity, else the newest; null with no build.
 */
export function playingBuild<T extends RunLike>(
  runs: readonly T[],
  pinnedRunId: string | null | undefined,
): T | null {
  const builds = succeededBuilds(runs);
  return (pinnedRunId && builds.find((run) => run.runId === pinnedRunId)) || builds[0] || null;
}

export interface BuildFile {
  bytes: number;
  sha256: string;
}

/**
 * A build's source files by relative path (forward slashes), or null when the folder is
 * gone. Links are not followed.
 */
export async function moduleBuildFiles(root: string): Promise<Map<string, BuildFile> | null> {
  const top = await fs.lstat(root).catch(() => null);
  if (!top?.isDirectory()) return null;
  const files = new Map<string, BuildFile>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (files.size >= FILES_MAX) return;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(full, relative);
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(full).catch(() => null);
        if (bytes)
          files.set(relative, {
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
      }
    }
  };
  await walk(root, "");
  return files;
}

/**
 * How many source files a build holds, without reading them; null when the folder is gone.
 * The same files `moduleBuildFiles` reads, for a listing that only counts.
 */
export async function moduleBuildFileCount(root: string): Promise<number | null> {
  const top = await fs.lstat(root).catch(() => null);
  if (!top?.isDirectory()) return null;
  let count = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (count >= FILES_MAX) return;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) count++;
    }
  };
  await walk(root);
  return count;
}

/** Whether a compare reads this file as text. */
export function isBuildText(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/**
 * The files that differ going from build `from` (at `fromRoot`) to build `to`, with the
 * text of each changed text file under the size limit. A build whose folder is gone holds
 * no files.
 */
export async function compareModuleBuilds(
  from: { runId: string; root: string },
  to: { runId: string; root: string },
): Promise<ModuleBuildDiff> {
  const before = (await moduleBuildFiles(from.root)) ?? new Map<string, BuildFile>();
  const after = (await moduleBuildFiles(to.root)) ?? new Map<string, BuildFile>();
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const files: ModuleBuildFileDiff[] = [];
  let unchanged = 0;
  let budget = DIFF_TEXT_BUDGET;
  const read = async (root: string, file: string) =>
    (await fs.readFile(path.join(root, ...file.split("/")), "utf8").catch(() => null)) ?? null;
  for (const file of paths) {
    const a = before.get(file);
    const b = after.get(file);
    if (a && b && a.sha256 === b.sha256) {
      unchanged++;
      continue;
    }
    const entry: ModuleBuildFileDiff = {
      path: file,
      change: !a ? "added" : !b ? "removed" : "changed",
      beforeBytes: a?.bytes ?? null,
      afterBytes: b?.bytes ?? null,
      text: "shown",
      before: null,
      after: null,
    };
    const size = (a?.bytes ?? 0) + (b?.bytes ?? 0);
    if (!isBuildText(file)) entry.text = "binary";
    else if ((a?.bytes ?? 0) > BUILD_TEXT_MAX || (b?.bytes ?? 0) > BUILD_TEXT_MAX || size > budget)
      entry.text = "too_large";
    else {
      budget -= size;
      entry.before = a ? await read(from.root, file) : null;
      entry.after = b ? await read(to.root, file) : null;
    }
    files.push(entry);
  }
  return { from: from.runId, to: to.runId, files, unchanged };
}
