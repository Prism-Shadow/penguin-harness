/**
 * The impl diff view's logic, kept apart from its markup so it runs without a DOM: the changed
 * files grouped by directory, a file's hunks as the unified patch the shared DiffViewer draws, the
 * remembered layout, which files are open, and the note a file carries in place of its hunks.
 */
import type {
  ProposalImplChangedFile,
  ProposalImplChanges,
  ProposalImplHunk,
} from "@prismshadow/penguin-server/api";

export type DiffLayout = "unified" | "split";

/** The localStorage key the unified/split choice is remembered under, per browser. */
export const DIFF_LAYOUT_KEY = "penguin.proposals.diffLayout";

/** The remembered layout; unified when storage is unavailable or holds anything else. */
export function readDiffLayout(storage: Pick<Storage, "getItem"> | null): DiffLayout {
  try {
    return storage?.getItem(DIFF_LAYOUT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

/** Remembers the layout; a storage that refuses (private mode, quota) is ignored. */
export function writeDiffLayout(
  storage: Pick<Storage, "setItem"> | null,
  layout: DiffLayout,
): void {
  try {
    storage?.setItem(DIFF_LAYOUT_KEY, layout);
  } catch {
    // Remembering is a convenience: the choice still holds for this view.
  }
}

/** The browser's localStorage, or null where reading it throws (a sandboxed frame). */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export interface DirectoryGroup {
  /** The directory, `""` for the repository's root. */
  dir: string;
  files: ProposalImplChangedFile[];
}

/** The files grouped by their directory, directories and files each in path order. */
export function groupByDirectory(files: readonly ProposalImplChangedFile[]): DirectoryGroup[] {
  const groups = new Map<string, ProposalImplChangedFile[]>();
  for (const file of files) {
    const cut = file.path.lastIndexOf("/");
    const dir = cut < 0 ? "" : file.path.slice(0, cut);
    const list = groups.get(dir);
    if (list === undefined) groups.set(dir, [file]);
    else list.push(file);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dir, list]) => ({
      dir,
      files: [...list].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    }));
}

/** A path's last segment. */
export const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** The hunks as a unified patch, the text the shared DiffViewer parses. */
export function patchOf(hunks: readonly ProposalImplHunk[]): string {
  const sign = { add: "+", del: "-", context: " " } as const;
  return hunks
    .map((h) => {
      const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${
        h.section === "" ? "" : ` ${h.section}`
      }`;
      return [header, ...h.lines.map((l) => `${sign[l.kind]}${l.text}`)].join("\n");
    })
    .join("\n");
}

/** The sums over the files: what the view's header says, and what `+N/−M` says of the same diff. */
export function totalsOf(files: readonly ProposalImplChangedFile[]): {
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (t, f) => ({ additions: t.additions + f.additions, deletions: t.deletions + f.deletions }),
    { additions: 0, deletions: 0 },
  );
}

/** What stands in a file's body when it has no hunks to draw, or null when it has. */
export type FileNote =
  | { kind: "binary" }
  | { kind: "tooLarge"; kib: number }
  | { kind: "diffLimit"; mib: number }
  | { kind: "noPatch" }
  | { kind: "noContent" };

export function fileNote(
  file: ProposalImplChangedFile,
  limits: ProposalImplChanges["limits"],
): FileNote | null {
  if (file.binary) return { kind: "binary" };
  if (file.omitted === "tooLarge")
    return { kind: "tooLarge", kib: Math.round(limits.fileBytes / 1024) };
  if (file.omitted === "diffLimit") {
    return { kind: "diffLimit", mib: Math.round(limits.diffBytes / (1024 * 1024)) };
  }
  if (file.omitted === "noPatch") return { kind: "noPatch" };
  return file.hunks.length === 0 ? { kind: "noContent" } : null;
}

/** Past this many files, every file starts folded: drawing hundreds of diffs at once is the cost. */
export const OPEN_BY_DEFAULT_MAX = 30;

/**
 * Which files are open: each starts open in a small diff and folded in a large one, and `flipped`
 * holds the paths the reader turned the other way.
 */
export function isOpen(path: string, fileCount: number, flipped: ReadonlySet<string>): boolean {
  return fileCount <= OPEN_BY_DEFAULT_MAX !== flipped.has(path);
}

/** `flipped` after the reader folds or unfolds a file. */
export function toggleFile(flipped: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(flipped);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** `flipped` with the file open: jumping to a file shows it. */
export function openFile(
  flipped: ReadonlySet<string>,
  path: string,
  fileCount: number,
): ReadonlySet<string> {
  return isOpen(path, fileCount, flipped) ? flipped : toggleFile(flipped, path);
}

/** The DOM id of a file's block in the diff pane, by its place in the list. */
export const fileAnchorId = (index: number): string => `impl-diff-file-${index}`;
