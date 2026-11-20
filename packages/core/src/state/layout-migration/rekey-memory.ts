/**
 * Moving Workspace Memory along with the Workspaces that moved. A Workspace's Memory is keyed by
 * its real path (memory.ts: `<basename>-<hash of the path>`), so a Workspace inside a moved
 * Project folder — an organization's desk, a folder an Agent was given inside it — would come
 * up under a new key with empty Memory, its old Memory orphaned under the old one.
 *
 * Every Workspace scope records the path it was keyed from in its `.workspace` marker, which is
 * what this reads: in every Agent of the data root (an Agent of one Project may have worked in
 * another's folder), a scope whose marker lies under a moved folder is renamed to the key of its
 * new path, and its marker rewritten. A scope whose new key is already taken keeps both, and says
 * so: a Session opened in the moved Workspace between the move and this pass started a scope of
 * its own, and merging two Memory indexes is the model's work, not this one's.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  readWorkspaceMarker,
  USER_SCOPE_KEY,
  WORKSPACE_MARKER_FILENAME,
  workspaceMemoryKeyForRealPath,
} from "../memory.js";
import { agentsDir, memoryDir } from "../paths.js";
import { listProjectDirs } from "../project-dirs.js";
import type { PathMove } from "./journal.js";
import { lstatOrNull } from "./move.js";
import { movedPath } from "./rewrite.js";

async function childNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Re-keys the Workspace Memory of every Agent whose scopes record a path under a move's `from`. */
export async function rekeyWorkspaceMemory(
  root: string,
  moves: readonly PathMove[],
  log: (line: string) => void,
): Promise<void> {
  if (moves.length === 0) return;
  // A marker holds a real path, and the data root may be reached through a link of its own
  // (macOS's /var is /private/var): each move is matched in both spellings.
  const realRoot = await fs.realpath(root).catch(() => root);
  const spelled = moves.flatMap(({ from, to }) => {
    const real = (p: string) => path.join(realRoot, path.relative(root, p));
    return realRoot === root
      ? [{ from, to }]
      : [
          { from, to },
          { from: real(from), to: real(to) },
        ];
  });
  for (const { id: projectId } of await listProjectDirs(root)) {
    for (const agentId of await childNames(agentsDir(root, projectId))) {
      const memory = memoryDir(root, projectId, agentId);
      for (const key of await childNames(memory)) {
        if (key === USER_SCOPE_KEY) continue;
        const marker = await readWorkspaceMarker(path.join(memory, key));
        const moved = marker === undefined ? null : movedPath(marker, spelled);
        if (moved === null) continue;
        const nextKey = workspaceMemoryKeyForRealPath(moved);
        if (nextKey === key) continue;
        const next = path.join(memory, nextKey);
        if ((await lstatOrNull(next)) !== null) {
          log(
            `[layout] ${projectId}/${agentId}: the Memory of ${moved} is kept under both ` +
              `${key} (before the move) and ${nextKey}: merge them by hand if both matter`,
          );
          continue;
        }
        await fs.rename(path.join(memory, key), next);
        await fs.writeFile(path.join(next, WORKSPACE_MARKER_FILENAME), `${moved}\n`, "utf8");
      }
    }
  }
}
