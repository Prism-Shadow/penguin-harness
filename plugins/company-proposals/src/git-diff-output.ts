/**
 * `git diff-tree` output read into the mirror's diff entries (git-mirror.ts). Pure: no git.
 */
import type { MirrorDiffEntry } from "./ports.js";

const ZERO = /^0+$/;

/**
 * `diff-tree -z --raw --numstat` output: the raw records (`:<modes> <oids> <status>`, then one
 * path, or two for a rename) followed by the numstat ones (`<adds>\t<dels>\t<path>`, or an
 * empty path then the two paths of a rename; `-` counts for a binary file), in the same order.
 */
export function parseRawNumstat(out: string): MirrorDiffEntry[] {
  const tokens = out.split("\0");
  const entries: MirrorDiffEntry[] = [];
  const stats = new Map<string, Pick<MirrorDiffEntry, "binary" | "additions" | "deletions">>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "") continue;
    if (token.startsWith(":")) {
      const [, , oldOid, newOid, status] = token.slice(1).split(" ");
      const letter = (status ?? "M")[0]!;
      const two = letter === "R" || letter === "C";
      const first = tokens[++i] ?? "";
      const second = two ? (tokens[++i] ?? "") : first;
      entries.push({
        status:
          letter === "A" ? "added" : letter === "D" ? "deleted" : two ? "renamed" : "modified",
        path: second,
        oldPath: two ? first : null,
        oldOid: oldOid !== undefined && !ZERO.test(oldOid) ? oldOid : null,
        newOid: newOid !== undefined && !ZERO.test(newOid) ? newOid : null,
        additions: 0,
        deletions: 0,
        binary: false,
      });
      continue;
    }
    const [adds, dels, inline] = token.split("\t");
    // A rename's numstat names its paths in the next two tokens; the new one is the key.
    const key = inline === "" ? (tokens[(i += 2)] ?? "") : (inline ?? "");
    const binary = adds === "-" && dels === "-";
    stats.set(key, {
      binary,
      additions: binary ? 0 : Number(adds) || 0,
      deletions: binary ? 0 : Number(dels) || 0,
    });
  }
  // Joined by path, not by position: under `-w` a whitespace-only change may have no numstat line.
  for (const entry of entries) {
    const stat = stats.get(entry.path);
    if (stat !== undefined) Object.assign(entry, stat);
  }
  return entries;
}
