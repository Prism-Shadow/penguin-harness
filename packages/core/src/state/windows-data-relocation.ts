import fs from "node:fs";
import path from "node:path";
import { listProjectDirs } from "./project-dirs.js";
import { rekeyWorkspaceMemory } from "./layout-migration/rekey-memory.js";
import type { PathMove } from "./layout-migration/journal.js";
import {
  movedPath,
  projectPathFiles,
  rewriteFilePaths,
  rewriteTextPaths,
} from "./layout-migration/rewrite.js";

const cache = new Map<string, readonly PathMove[]>();

/** Setup installs this history alongside the verified copy before switching its user pointer.
 * Historic Trace files remain byte-for-byte evidence, including their original drive letters. */
export function windowsDataMoves(root: string): readonly PathMove[] {
  if (process.platform !== "win32" || path.basename(root).toLowerCase() !== "data") return [];
  const known = cache.get(root);
  if (known) return known;
  const file = path.join(path.dirname(root), "windows-data-roots.json");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cache.set(root, []);
    return [];
  }
  const { to, from } = JSON.parse(text);
  if (
    typeof to !== "string" ||
    path.relative(to, root) !== "" ||
    !Array.isArray(from) ||
    !from.every(
      (p: unknown) =>
        typeof p === "string" &&
        /^[A-Za-z]:[\\/].+/.test(p) &&
        path.parse(p).root !== p &&
        path.relative(p, root) !== "",
    )
  ) {
    throw new Error(`Invalid data relocation history in ${file}.`);
  }
  const moves = from.map((previous: string) => ({ from: previous, to: root }));
  cache.set(root, moves);
  return moves;
}

export function relocatedWorkspace(root: string, recorded: string): string {
  return movedPath(recorded, windowsDataMoves(root)) ?? recorded;
}

export function relocatedSystemPrompt(root: string, recorded: string): string {
  return rewriteTextPaths(recorded, windowsDataMoves(root));
}

/** Rewrite only the active copies of the known Project configuration and memory records. */
export async function relocateProjectWorkspacePaths(
  root: string,
  moves: readonly PathMove[],
  log: (line: string) => void,
): Promise<void> {
  for (const { dir } of await listProjectDirs(root)) {
    for (const file of await projectPathFiles(dir)) await rewriteFilePaths(file, moves);
  }
  await rekeyWorkspaceMemory(root, moves, log);
}
