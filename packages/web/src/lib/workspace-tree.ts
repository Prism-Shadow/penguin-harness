/**
 * Workspace files panel logic, kept DOM-free so it can be unit-tested:
 *   - the directory tree's shape — listings fetched lazily per directory and keyed by its
 *     Workspace-relative path ("" is the root), the set of open directories, and the flat
 *     row list the tree renders from the two;
 *   - the keyboard step over those rows (the WAI-ARIA tree pattern: up/down move, right
 *     opens a directory or steps into it, left closes it or steps out to its parent);
 *   - which directory a dropped batch lands in;
 *   - when the panel is too narrow for a tree beside a preview;
 *   - which files count as text — by extension, or by looking at their first bytes when
 *     the extension says nothing — and so can be previewed as text and edited in place;
 *   - the persisted tree-visibility preference and the unsaved-changes decision.
 */
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import { joinWorkspacePath } from "./file-path";

// ------------------------------------------------------------------------------- layout

/** Below this panel width the tree and the preview no longer fit side by side. */
export const TREE_LAYOUT_MIN_WIDTH = 480;

/**
 * Whether the panel falls back to the single-column drill-down (tree or preview, never
 * both). An unmeasured width (0, before the first ResizeObserver callback) keeps the
 * two-pane default rather than flashing the fallback for a frame.
 */
export function isNarrowLayout(panelWidth: number): boolean {
  return panelWidth > 0 && panelWidth < TREE_LAYOUT_MIN_WIDTH;
}

/** The tree pane's width beside a preview: about a third of the panel, clamped so names stay readable and the preview keeps its room. */
export function treePaneWidth(panelWidth: number): number {
  return Math.max(168, Math.min(256, Math.round(panelWidth * 0.36)));
}

// -------------------------------------------------------------------------------- paths

/** The directory a Workspace-relative path sits in ("" for a root-level entry). */
export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** The directories from the root down to the path's parent, root first: "a/b/c.txt" → ["", "a", "a/b"]. */
export function ancestorDirs(path: string): string[] {
  const out = [""];
  const segments = path.split("/").filter((s) => s !== "");
  for (let i = 1; i < segments.length; i += 1) out.push(segments.slice(0, i).join("/"));
  return out;
}

// --------------------------------------------------------------------------------- tree

/** Loaded directory listings by directory path ("" = the Workspace root). A missing key means "not fetched yet". */
export type Listings = ReadonlyMap<string, readonly WorkspaceFileEntry[]>;

/** Directories first, then by name — the order the server lists in, reapplied after a client-side insertion. */
export function sortEntries(entries: readonly WorkspaceFileEntry[]): WorkspaceFileEntry[] {
  return [...entries].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );
}

/**
 * The listings with `entry` in `dir`, inserted in sorted position and replacing a same-named
 * entry (an upload or a save overwrote it). Returns a new map; the input is left untouched.
 */
export function upsertEntry(
  listings: Listings,
  dir: string,
  entry: WorkspaceFileEntry,
): Map<string, readonly WorkspaceFileEntry[]> {
  const next = new Map(listings);
  const current = listings.get(dir) ?? [];
  next.set(dir, sortEntries([...current.filter((e) => e.name !== entry.name), entry]));
  return next;
}

/** The expanded set with every directory above `path` open, so the row for `path` is on screen. */
export function expandTo(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded);
  for (const dir of ancestorDirs(path)) next.add(dir);
  return next;
}

/**
 * The expanded set with `dir` opened (its ancestors too, so it is reachable) or closed. Closing
 * leaves the descendants' own state alone: reopening the directory brings back the subtree the
 * way it was left.
 */
export function withExpanded(
  expanded: ReadonlySet<string>,
  dir: string,
  open: boolean,
): Set<string> {
  if (open) {
    const next = expandTo(expanded, dir);
    next.add(dir);
    return next;
  }
  const next = new Set(expanded);
  next.delete(dir);
  return next;
}

/** One rendered tree row: an entry plus where it sits and, for a directory, its open/loaded state. */
export interface TreeRow {
  path: string;
  name: string;
  kind: "dir" | "file";
  /** Nesting depth; a root-level entry is 0. */
  depth: number;
  /** Directory rows: whether it is open. */
  expanded: boolean;
  /** Directory rows: whether its listing has arrived (an open, unloaded directory is being fetched). */
  loaded: boolean;
  /** Directory rows: loaded and holding nothing. */
  empty: boolean;
  sizeBytes: number;
  mtime: string;
}

/**
 * The rows the tree draws, top to bottom: a depth-first walk from the root (always open)
 * into every open directory whose listing has arrived. An open directory that is still
 * loading contributes its own row and no children.
 */
export function flattenTree(listings: Listings, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of listings.get(dir) ?? []) {
      const path = joinWorkspacePath(dir, entry.name);
      const isDir = entry.kind === "dir";
      const open = isDir && expanded.has(path);
      const children = isDir ? listings.get(path) : undefined;
      rows.push({
        path,
        name: entry.name,
        kind: entry.kind,
        depth,
        expanded: open,
        loaded: !isDir || children !== undefined,
        empty: isDir && children !== undefined && children.length === 0,
        sizeBytes: entry.sizeBytes,
        mtime: entry.mtime,
      });
      if (open && children !== undefined) walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** What one navigation key does to the tree: move focus, open a directory, or close one. */
export interface TreeKeyAction {
  focus?: string;
  expand?: string;
  collapse?: string;
}

/**
 * The keyboard step for `key` with `focused` as the current row (null: none yet), or null
 * when the key is not a tree key or has nothing to do.
 *   - ArrowDown / ArrowUp move within the rows on screen (clamped at the ends); with no
 *     focused row either lands on the first row.
 *   - ArrowRight opens a closed directory, steps into the first child of an open one.
 *   - ArrowLeft closes an open directory, otherwise steps out to the parent row.
 *   - Home / End jump to the first / last row.
 */
export function treeKeyStep(
  rows: readonly TreeRow[],
  focused: string | null,
  key: string,
): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const index = focused === null ? -1 : rows.findIndex((r) => r.path === focused);
  const row = index >= 0 ? rows[index]! : null;
  switch (key) {
    case "ArrowDown":
      return { focus: rows[Math.min(rows.length - 1, index + 1)]!.path };
    case "ArrowUp":
      return { focus: rows[Math.max(0, index - 1)]!.path };
    case "Home":
      return { focus: first.path };
    case "End":
      return { focus: rows[rows.length - 1]!.path };
    case "ArrowRight": {
      if (row === null) return { focus: first.path };
      if (row.kind !== "dir") return null;
      if (!row.expanded) return { expand: row.path };
      const next = rows[index + 1];
      return next !== undefined && next.depth > row.depth ? { focus: next.path } : null;
    }
    case "ArrowLeft": {
      if (row === null) return null;
      if (row.kind === "dir" && row.expanded) return { collapse: row.path };
      return row.path.includes("/") ? { focus: parentDir(row.path) } : null;
    }
    default:
      return null;
  }
}

// --------------------------------------------------------------------------------- drop

/**
 * The directory a drop lands in: a folder row under the pointer takes the files itself, a
 * file row hands them to its own directory, and anywhere else in the panel means the
 * current directory.
 */
export function dropTargetDir(
  hit: { kind: "dir" | "file"; path: string } | null,
  currentDir: string,
): string {
  if (hit === null) return currentDir;
  return hit.kind === "dir" ? hit.path : parentDir(hit.path);
}

// ---------------------------------------------------------------------------- file kinds

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "json",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "bash",
  "yaml",
  "yml",
  "toml",
  "css",
  "csv",
  "log",
  "xml",
  "ini",
  "conf",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "sql",
  "rb",
  "php",
  "gitignore",
  "env",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const HTML_EXTS = new Set(["html", "htm"]);

/**
 * How a file previews, decided from its name. `unknown` is not "unsupported" yet: the
 * browser reads such a file's first bytes and treats it as text when they look like text
 * (a Makefile, a LICENSE, a dotfile with no extension).
 */
export type PreviewKind = "text" | "md" | "image" | "html" | "pdf" | "unknown";

/** The lowercased extension, or the whole lowercased name when it has none ("Makefile" → "makefile", ".env" → "env"). */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : name.toLowerCase();
}

export function previewKindFor(name: string): PreviewKind {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (HTML_EXTS.has(ext)) return "html";
  if (ext === "md") return "md";
  if (TEXT_EXTS.has(ext)) return "text";
  return "unknown";
}

/**
 * `bytes` without a multi-byte UTF-8 sequence cut off at its end: a read chunk can end
 * anywhere, and judging validity on the partial character would call a text file binary.
 */
export function utf8Complete(bytes: Uint8Array): Uint8Array {
  let i = bytes.length - 1;
  let back = 0;
  while (i >= 0 && back < 3 && (bytes[i]! & 0xc0) === 0x80) {
    i -= 1;
    back += 1;
  }
  if (i < 0) return bytes;
  const lead = bytes[i]!;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return bytes.length - i < need ? bytes.subarray(0, i) : bytes;
}

/** Control bytes a text file legitimately carries: tab, LF, CR, FF, backspace, escape (ANSI-colored logs). */
const TEXT_CONTROL_BYTES = new Set([8, 9, 10, 12, 13, 27]);

/**
 * Whether a sample of a file's bytes reads as text: no NUL byte, few other control bytes,
 * and valid UTF-8 once a trailing partial character is set aside. Deliberately strict —
 * a binary mistaken for text becomes an editable garble, while a text file of some other
 * encoding merely stays a download.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 0x20 && !TEXT_CONTROL_BYTES.has(b)) control += 1;
  }
  if (control / bytes.length > 0.1) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(utf8Complete(bytes));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------ editing

/** Bytes a text preview reads before it is cut off; a longer file previews truncated and cannot be edited in place. */
export const TEXT_PREVIEW_LIMIT = 256 * 1024;

/** Per-file ceiling of the content write endpoint, in whole MB — the server's `MAX_UPLOAD_BYTES`, mirrored so an oversize save or upload is refused before any bytes travel. */
export const WORKSPACE_UPLOAD_LIMIT_MB = 14;

/**
 * Whether a preview can switch to the editor: a text-like kind whose full content is (or can
 * be) on hand. A truncated preview is exactly the case that must stay read-only — saving it
 * back would write the truncated text over the whole file.
 */
export function canEditPreview(preview: { kind: string; truncated?: boolean }): boolean {
  return (
    (preview.kind === "text" || preview.kind === "md" || preview.kind === "html") &&
    preview.truncated !== true
  );
}

/** The in-place editor: the file, the text it opened with, and what has been typed since. */
export interface EditorState {
  path: string;
  baseline: string;
  draft: string;
}

export function isDirty(editor: EditorState | null): boolean {
  return editor !== null && editor.draft !== editor.baseline;
}

/**
 * Whether landing on `nextPath` (null: on no file) would abandon typed changes and so must
 * ask first. Re-opening the file being edited keeps the editor and asks nothing.
 */
export function needsDiscardConfirm(editor: EditorState | null, nextPath: string | null): boolean {
  return isDirty(editor) && nextPath !== editor!.path;
}

// --------------------------------------------------------------------------- preference

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface TreePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One global preference, not per Session: whether the tree pane is shown. */
export const TREE_VISIBLE_KEY = "penguin.files.treeVisible";

/** Tolerant parse: only an explicit "off" spelling hides the tree; nothing stored or anything unrecognized shows it (the default). */
export function parseTreeVisible(raw: string | null): boolean {
  if (raw === null) return true;
  const value = raw.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "hidden" || value === "no");
}

export function readTreeVisible(storage?: TreePreferenceStorage): boolean {
  try {
    // localStorage is resolved inside the try: merely touching it throws when site data is
    // blocked, and this runs from a useState initializer.
    return parseTreeVisible((storage ?? localStorage).getItem(TREE_VISIBLE_KEY));
  } catch {
    return true;
  }
}

export function writeTreeVisible(visible: boolean, storage?: TreePreferenceStorage): void {
  try {
    (storage ?? localStorage).setItem(TREE_VISIBLE_KEY, visible ? "1" : "0");
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
