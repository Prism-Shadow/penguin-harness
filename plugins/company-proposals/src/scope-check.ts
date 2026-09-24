/**
 * The scope against the working tree. The plugin runs on the server that owns the
 * organization, so the shared workspace is a local directory: a publish checks that every file
 * the change edits, deletes or renames from is there (under the proposal's `root`), and a read
 * reports each entry's state. A path that is not there is named with the likely one — the path
 * without a `legacy` segment, or files of the same name found in a bounded walk — because the
 * common failure is a scope written against an older layout.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ProposalScopeEntry, ProposalScopeState } from "@prismshadow/penguin-server/api";

/** Directories the basename walk never enters: tool state, dependencies and build output. */
const SKIPPED_DIRS = new Set([
  "node_modules",
  "target",
  "build",
  "dist",
  "out",
  "vendor",
  "__pycache__",
]);
const WALK_MAX_DEPTH = 8;
const WALK_MAX_ENTRIES = 20_000;
const MAX_SUGGESTIONS = 2;

/** The absolute directory a scope resolves under: the shared workspace, then the root. */
export function scopeBase(workspace: string, root: string): string {
  return root === "" ? workspace : path.join(workspace, ...root.split("/"));
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

async function isDir(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

const under = (base: string, rel: string): string => path.join(base, ...rel.split("/"));

/** Each entry's state in the working tree under `base`. */
export async function scopeStates(
  base: string,
  scope: readonly ProposalScopeEntry[],
): Promise<ProposalScopeState[]> {
  return Promise.all(
    scope.map(async (e): Promise<ProposalScopeState> => {
      const here = await isFile(under(base, e.file));
      switch (e.kind) {
        case "edit":
          return here ? "exists" : "missing";
        case "new":
          return here ? "exists" : "new";
        case "delete":
          return here ? "exists" : "deleted";
        case "rename":
          if (here) return "exists";
          return e.from !== undefined && (await isFile(under(base, e.from)))
            ? "renamed"
            : "missing";
      }
    }),
  );
}

/** Up to two paths (relative to base) where a missing file probably is. */
export async function suggestPaths(base: string, rel: string): Promise<string[]> {
  const out: string[] = [];
  const segments = rel.split("/");
  // The layout that moved: the same path with one `legacy` segment dropped.
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] !== "legacy") continue;
    const candidate = [...segments.slice(0, i), ...segments.slice(i + 1)].join("/");
    if (await isFile(under(base, candidate))) out.push(candidate);
  }
  if (out.length >= MAX_SUGGESTIONS) return out.slice(0, MAX_SUGGESTIONS);
  // Else a file of the same name elsewhere, found by a bounded breadth-first walk.
  const name = segments[segments.length - 1]!;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: "", depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && out.length < MAX_SUGGESTIONS && visited < WALK_MAX_ENTRIES) {
    const { dir, depth } = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir === "" ? base : under(base, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > WALK_MAX_ENTRIES) break;
      const relPath = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth < WALK_MAX_DEPTH && !entry.name.startsWith(".") && !SKIPPED_DIRS.has(entry.name))
          queue.push({ dir: relPath, depth: depth + 1 });
      } else if (entry.name === name && relPath !== rel && !out.includes(relPath)) {
        out.push(relPath);
        if (out.length >= MAX_SUGGESTIONS) break;
      }
    }
  }
  return out;
}

export interface ScopeCheck {
  /** The root is not a directory: nothing else was checked. */
  rootMissing: boolean;
  /** Paths that must exist and do not, each with the likely paths. */
  missing: Array<{ path: string; suggestions: string[] }>;
  /** Accepted, but worth a look. */
  hints: string[];
}

/**
 * What a publish checks: the root is a directory; an edit's or a delete's file, and a rename's
 * source, exist. A new file that exists already and a rename whose target exists already are
 * hints, not refusals.
 */
export async function checkScope(
  base: string,
  scope: readonly ProposalScopeEntry[],
): Promise<ScopeCheck> {
  if (!(await isDir(base))) return { rootMissing: true, missing: [], hints: [] };
  const missing: ScopeCheck["missing"] = [];
  const hints: string[] = [];
  for (const e of scope) {
    const must = e.kind === "rename" ? e.from : e.kind === "new" ? undefined : e.file;
    if (must !== undefined && !(await isFile(under(base, must)))) {
      missing.push({ path: must, suggestions: await suggestPaths(base, must) });
    }
    if (e.kind === "new" && (await isFile(under(base, e.file)))) {
      hints.push(`${e.file} is listed as new but already exists — is it an edit?`);
    }
    if (e.kind === "rename" && (await isFile(under(base, e.file)))) {
      hints.push(`rename target ${e.file} already exists.`);
    }
  }
  return { rootMissing: false, missing, hints };
}

/** The refusal's text: every missing path, each with what it probably is. */
export function missingMessage(root: string, missing: ScopeCheck["missing"]): string {
  const where = root === "" ? "the shared workspace" : `root \`${root}\``;
  const lines = missing.map(
    (m) =>
      `- ${m.path}${m.suggestions.length > 0 ? ` — did you mean ${m.suggestions.map((s) => `\`${s}\``).join(" or ")}?` : ""}`,
  );
  return `These scope files do not exist under ${where}; fix the paths, or list a file the change creates as \`kind: new\`:\n${lines.join("\n")}`;
}
