/**
 * Workspace files panel logic, kept DOM-free so it can be unit-tested:
 *   - the directory tree's shape — listings fetched lazily per directory and keyed by its
 *     Workspace-relative path ("" is the root), the set of open directories, and the flat
 *     row list the tree renders from the two (the row's own shape and the keyboard step over
 *     it are shared with the app's other file trees, in lib/file-tree.ts);
 *   - the search box's filter over the rows that are loaded;
 *   - which directory a dropped batch lands in;
 *   - when the panel is too narrow for a tree beside a preview, and how wide the tree pane
 *     may be dragged when it is not;
 *   - how many breadcrumb segments fit on the toolbar's single row;
 *   - which files count as text — by extension, or by looking at their first bytes when
 *     the extension says nothing — and so can be previewed as text and edited in place;
 *   - the persisted preferences (tree visibility, tree width, editor soft wrap) and the
 *     unsaved-changes decision.
 */
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import { joinWorkspacePath } from "./file-path";
import type { FileTreeRow } from "./file-tree";

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

/** Narrowest the tree pane may be dragged: below this a nested name is all ellipsis. */
export const TREE_MIN_WIDTH = 160;

/**
 * The divider between the tree and the preview, in px — `w-1.5` in the panel. It rides with
 * the tree pane in the sliding container that shows and hides them together, which is why
 * that container's width has to know it.
 */
export const TREE_DIVIDER_PX = 6;

/** Room the preview keeps whatever the tree is dragged to. */
export const PREVIEW_MIN_WIDTH = 240;

/**
 * The tree pane's width until the user drags the divider: about a third of the panel,
 * within bounds that keep names readable and leave the preview its room.
 */
export function defaultTreeWidth(panelWidth: number): number {
  return Math.max(168, Math.min(256, Math.round(panelWidth * 0.36)));
}

/** Widest the tree pane may be dragged at this panel width — never below the tree's own minimum, so a panel with no room for both still has a draggable range of zero rather than an inverted one. */
export function maxTreeWidth(panelWidth: number): number {
  return Math.max(TREE_MIN_WIDTH, panelWidth - PREVIEW_MIN_WIDTH);
}

/**
 * A tree-pane width brought within this panel's bounds. An unmeasured panel (0, before the
 * first ResizeObserver callback) has no ceiling to apply: clamping against it would size
 * the pane to the minimum for one frame and then jump.
 */
export function clampTreeWidth(width: number, panelWidth: number): number {
  const requested = Math.max(TREE_MIN_WIDTH, Math.round(Number.isFinite(width) ? width : 0));
  return panelWidth <= 0 ? requested : Math.min(maxTreeWidth(panelWidth), requested);
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

/** One rendered tree row: a shared tree row plus what the Workspace shows beside a file's name. */
export interface TreeRow extends FileTreeRow {
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
    const entries = listings.get(dir) ?? [];
    for (const [index, entry] of entries.entries()) {
      const path = joinWorkspacePath(dir, entry.name);
      const isDir = entry.kind === "dir";
      const open = isDir && expanded.has(path);
      const children = isDir ? listings.get(path) : undefined;
      rows.push({
        path,
        name: entry.name,
        kind: entry.kind,
        depth,
        posInSet: index + 1,
        setSize: entries.length,
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

/**
 * The rows left by the search box, or all of them for an empty query. Matching is a
 * case-insensitive substring of the entry's own name; the panel hands in rows walked with
 * every LISTED directory open, so what can be searched is exactly what has been loaded.
 *
 * A kept row is one of three things: a match; an ancestor of a match, without which the
 * match would have nothing to hang under; or anything inside a directory that matched,
 * since a directory that matched is being shown as a directory, with its contents.
 */
export function filterTreeRows(rows: readonly TreeRow[], query: string): TreeRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  const matched = new Set<string>();
  const keep = new Set<string>();
  for (const row of rows) {
    if (!row.name.toLowerCase().includes(needle)) continue;
    matched.add(row.path);
    keep.add(row.path);
    for (const dir of ancestorDirs(row.path)) if (dir !== "") keep.add(dir);
  }
  if (matched.size === 0) return [];
  return rows.filter(
    (row) =>
      keep.has(row.path) || ancestorDirs(row.path).some((dir) => dir !== "" && matched.has(dir)),
  );
}

// -------------------------------------------------------------------------- breadcrumbs

/** The single item a run of dropped leading segments collapses into. */
export const CRUMB_ELLIPSIS = "…";

/** What of a path the toolbar can show: the trailing segments that fit, and whether anything was dropped ahead of them. */
export interface CrumbLayout {
  visible: string[];
  collapsed: boolean;
}

/**
 * Which breadcrumb segments fit across `availablePx`, tail first. The current directory —
 * the last segment — is always kept, however long it is; leading segments are taken while
 * they fit and the rest collapse into one ellipsis item, so the toolbar's actions never get
 * pushed onto a second row. `measure` gives a rendered item's width in px, ellipsis item
 * included, which is what lets a test state a fixed per-character width.
 */
export function visibleCrumbSegments(
  segments: readonly string[],
  availablePx: number,
  measure: (text: string) => number,
): CrumbLayout {
  if (segments.length === 0) return { visible: [], collapsed: false };
  const last = segments.length - 1;
  const visible = [segments[last]!];
  let used = measure(segments[last]!);
  for (let i = last - 1; i >= 0; i -= 1) {
    // Taking this segment still leaves an ellipsis ahead of it unless it is the first one,
    // so the ellipsis is priced into every step but the last.
    const ellipsis = i > 0 ? measure(CRUMB_ELLIPSIS) : 0;
    const width = measure(segments[i]!);
    if (used + width + ellipsis > availablePx) break;
    visible.unshift(segments[i]!);
    used += width;
  }
  return { visible, collapsed: visible.length < segments.length };
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
  /**
   * The version marker the baseline was read with, sent back as the save's write
   * precondition so the write cannot land on a file the Agent has since rewritten.
   */
  version: string;
  /** The file was found to carry a different version while this editor was open. */
  changedOnDisk?: boolean;
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

/** Global preferences, not per Session: whether the tree pane is shown, how wide it is, and whether the editor soft-wraps. */
export const TREE_VISIBLE_KEY = "penguin.files.treeVisible";
export const TREE_WIDTH_KEY = "penguin.files.treeWidth";
export const EDITOR_WRAP_KEY = "penguin.files.editorWrap";

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

/**
 * Tolerant parse of the stored tree width: null for nothing stored and for anything that is
 * not a positive number, which is what makes the caller fall back to the width the pane had
 * before it was ever dragged.
 */
export function parseTreeWidth(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function readTreeWidth(storage?: TreePreferenceStorage): number | null {
  try {
    return parseTreeWidth((storage ?? localStorage).getItem(TREE_WIDTH_KEY));
  } catch {
    return null;
  }
}

export function writeTreeWidth(width: number, storage?: TreePreferenceStorage): void {
  try {
    (storage ?? localStorage).setItem(TREE_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/** Tolerant parse of the editor's soft-wrap preference: OFF unless an explicit on spelling is stored — long lines scrolling sideways is the default a code editor has. */
export function parseEditorWrap(raw: string | null): boolean {
  if (raw === null) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function readEditorWrap(storage?: TreePreferenceStorage): boolean {
  try {
    return parseEditorWrap((storage ?? localStorage).getItem(EDITOR_WRAP_KEY));
  } catch {
    return false;
  }
}

export function writeEditorWrap(wrap: boolean, storage?: TreePreferenceStorage): void {
  try {
    (storage ?? localStorage).setItem(EDITOR_WRAP_KEY, wrap ? "1" : "0");
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
