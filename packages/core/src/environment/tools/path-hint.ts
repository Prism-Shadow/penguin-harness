/**
 * path-hint — shared missing-path diagnostic for the file tools (read_file / edit_file).
 *
 * A bare "File not found" regularly sends the model down the wrong road: it retries
 * relative/absolute variants of the same wrong path instead of questioning the path itself
 * (issue #138 — a missing `agent_state/` segment read as "absolute paths are rejected").
 * The cure is to show where the path leaves reality: walk up to the deepest existing
 * ancestor and list the entries closest in name to the missing segment, so the next call
 * can be the right one. Failure-path only — the extra stats/readdir never run on success.
 */
import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { modelVisiblePath } from "../../internal/model-visible-path.js";

/** Max directory entries named in the hint; the rest collapse into a "+N more" count. */
const MAX_LISTED_ENTRIES = 8;

/**
 * Entry labels ranked by longest shared case-insensitive prefix with the missing name
 * (near-misses like `agent_state/` vs `AGENTS.md` surface first), ties alphabetical.
 * Directories get a trailing "/" so the model can tell what one more segment would hit.
 */
function rankEntries(entries: Dirent[], missing: string): string[] {
  const target = missing.toLowerCase();
  const scored = entries.map((entry) => {
    const name = entry.name.toLowerCase();
    const max = Math.min(name.length, target.length);
    let prefix = 0;
    while (prefix < max && name[prefix] === target[prefix]) prefix += 1;
    return { entry, prefix };
  });
  scored.sort((a, b) => b.prefix - a.prefix || a.entry.name.localeCompare(b.entry.name));
  return scored.map(({ entry }) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
}

/**
 * Diagnostic sentence(s) for a path that failed to stat, prefixed with a space so callers
 * can append it verbatim to their own message ("" when nothing useful can be said).
 * Reports the deepest existing ancestor, the first missing segment, and the ancestor's
 * nearest-named entries — or that the "ancestor" is a file (the ENOTDIR case).
 */
export async function missingPathHint(resolved: string): Promise<string> {
  let ancestor = path.dirname(resolved);
  let missing = path.basename(resolved);
  for (;;) {
    try {
      const st = await stat(ancestor);
      if (!st.isDirectory()) {
        return ` Note: "${modelVisiblePath(ancestor)}" exists but is a file, not a directory.`;
      }
      break;
    } catch {
      // Any stat failure (missing, unreadable) keeps the walk going: report the deepest
      // ancestor that is *visibly* there. dirname is a fixpoint at the filesystem root.
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return "";
      missing = path.basename(ancestor);
      ancestor = parent;
    }
  }
  const head = ` The directory "${modelVisiblePath(ancestor)}" exists but has no entry "${missing}".`;
  let entries: Dirent[];
  try {
    entries = await readdir(ancestor, { withFileTypes: true });
  } catch {
    return head;
  }
  if (entries.length === 0) return `${head} It is empty.`;
  const labels = rankEntries(entries, missing);
  const shown = labels.slice(0, MAX_LISTED_ENTRIES);
  const hidden = labels.length - shown.length;
  return `${head} It contains: ${shown.join(", ")}${hidden > 0 ? ` (+${hidden} more)` : ""}.`;
}
