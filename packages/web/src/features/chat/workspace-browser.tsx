/**
 * Workspace file browser (the Files panel): a directory tree on the left, listing each
 * directory the first time it opens, and a preview of the selected file on the right —
 * Markdown / HTML rendered with a source toggle, text inline (highlighted), images inline
 * (click to zoom), PDF embedded, everything else offered as a download. Text files can be
 * edited in place: Edit swaps the preview for a plain textarea, Save writes the file back
 * through the content endpoint, and unsaved changes are guarded wherever they could be
 * lost. OS files dropped anywhere on the panel upload into the current directory — onto a
 * folder row, into that folder.
 *
 * A search box above the tree filters the rows the lazy tree has already loaded. The tree
 * can be hidden (toolbar toggle, shown by default), and the divider between the two panes
 * sets its width; both, and the editor's soft-wrap toggle, are browser preferences.
 * The panel's width is the dock's, which may be far narrower than the viewport, so the
 * layout follows a measured width rather than a viewport breakpoint: below
 * TREE_LAYOUT_MIN_WIDTH the panes stop sharing the row and the tree and the preview show
 * one at a time — selecting a file replaces the tree, Back returns to it, and the divider
 * has nothing to divide. Path scoping is the server's job (including creating missing
 * parent directories inside the sandbox).
 *
 * The toolbar is one row that never wraps: the breadcrumbs read the current path (the tree
 * beside them is what navigates), and when the path outgrows the space its leading segments
 * collapse into a single "…" so Refresh and Upload keep their places.
 *
 * A secondary click carries the panel's per-entry actions — copy the relative path, add a
 * `@path` reference to the conversation, upload into a folder, download a file — on the tree
 * rows and again on the preview body, where the file it acts on is the one being previewed
 * and a selection inside it can be added as a fenced block instead of the whole file. Two
 * gestures reach nothing and are left to the browser on purpose: inside the HTML and PDF
 * previews, which are iframes no handler on this side can hear, and inside the in-place
 * editor, where the native menu is how text gets pasted.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { useAuth } from "../../state/auth";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { joinWorkspacePath } from "../../lib/file-path";
import { dropRegionAction, isFileDrag } from "../../lib/file-drop";
import type { DragSignal } from "../../lib/file-drop";
import { MB_BYTES, splitBySize } from "../../lib/upload-limits";
import {
  CRUMB_ELLIPSIS,
  TEXT_PREVIEW_LIMIT,
  TREE_DIVIDER_PX,
  TREE_MIN_WIDTH,
  WORKSPACE_UPLOAD_LIMIT_MB,
  ancestorDirs,
  baseName,
  canEditPreview,
  clampTreeWidth,
  defaultTreeWidth,
  dropTargetDir,
  expandTo,
  extOf,
  filterTreeRows,
  flattenTree,
  isDirty,
  isNarrowLayout,
  looksLikeText,
  maxTreeWidth,
  needsDiscardConfirm,
  parentDir,
  pathReference,
  previewKindFor,
  readWrapLines,
  readTreeVisible,
  readTreeWidth,
  selectionBlock,
  upsertEntry,
  utf8Complete,
  visibleCrumbSegments,
  withExpanded,
  writeWrapLines,
  writeTreeVisible,
  writeTreeWidth,
} from "../../lib/workspace-tree";
import type { EditorState, InsertLayout, Listings } from "../../lib/workspace-tree";
import { isContextMenuKey, isLongPressPointer } from "../../lib/context-menu";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { useRowContextMenu } from "../../components/ui/context-menu";
import {
  CopiedStatus,
  CopyCheckGlyph,
  useCopied,
  writeClipboard,
} from "../../components/ui/copy-button";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import {
  CloseIcon,
  DOWNLOAD_ICON,
  EXTERNAL_LINK_ICON,
  FILE_EDIT_ICON,
  REFRESH_ICON,
  UPLOAD_ICON,
  WRAP_TEXT_ICON,
} from "../../components/ui/icons";
import { noAutofill } from "../../components/ui/input";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { SkeletonList } from "../../components/ui/skeleton";
import { Tooltip } from "../../components/ui/tooltip";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { setCloseGuard } from "../dock/close-guard";
import { tabKey } from "../dock/dock-state";
import { DOCK_TRANSITION_MS } from "../dock/use-dock-mount";
import { usePointerDrag } from "../dock/use-pointer-drag";
import { PAPERCLIP_ICON } from "./attached-files-banner";
import { CodeSurface } from "./code-block";
import { languageForExtension } from "./code-languages";
import { WorkspaceFileEditor } from "./workspace-editor";
import { WorkspaceFileMenuRows } from "./workspace-file-menu";
import type { FileMenuTarget } from "./workspace-file-menu";
import { WorkspaceTreeView } from "./workspace-tree-view";
import type { TreeToggle } from "./workspace-tree-view";

/** Source highlighting cap: tokenizing the full preview cap's worth of content in one go would block the main thread, so beyond this it falls back to unhighlighted. */
const HIGHLIGHT_LIMIT = 64 * 1024;
/** Bytes examined to decide whether a file with an unknown extension is text. */
const SNIFF_BYTES = 8 * 1024;
/** Window with a left pane: the tree toggle. */
const PANEL_LEFT_ICON = "M4 5h16v14H4zM10 5v14";
/** Left-pointing chevron: the narrow layout's back-to-tree button. */
const BACK_ICON = "M15 18l-6-6 6-6";

/** An external reference with a scheme (http(s)/mailto/data, etc.), passed through as-is in the md rendered view. */
const EXTERNAL_REF_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Resolves relative references (image src / link href) within the md rendered view: based on
 *  the md file's directory, handling ./ and ../ (clamped to the root if it would go past it);
 *  a leading "/" is treated as the Workspace root. */
function resolveRelative(baseDir: string, ref: string): string {
  const out = ref.startsWith("/") || baseDir === "" ? [] : baseDir.split("/");
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Storage shim injected into the HTML preview: when the sandbox lacks allow-same-origin, the
 * iframe has an opaque origin, and accessing localStorage/sessionStorage throws a SecurityError
 * that halts scripts. The shim runs before any page script and falls back to a synchronous
 * in-memory implementation (substituted only when the native access throws), preserving sandbox
 * isolation while letting the page's scripts run normally.
 */
const STORAGE_SHIM =
  "<script>(function(){function mk(){var m={};return{getItem:function(k){return k in m?m[k]:null}," +
  "setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}," +
  "key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}" +
  "['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(e){" +
  "Object.defineProperty(window,n,{value:mk(),configurable:true})}})})();</script>";

/** Injects the storage shim at the earliest possible script position in the HTML (right after <head>, otherwise right after <html>, otherwise at the very start). */
function withStorageShim(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + STORAGE_SHIM);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + STORAGE_SHIM);
  return STORAGE_SHIM + html;
}

interface Preview {
  path: string;
  name: string;
  kind: "text" | "md" | "image" | "html" | "pdf" | "unsupported";
  /** Content for kind=text/md/html (may be truncated). */
  content?: string;
  truncated?: boolean;
  /** The version the content was read at; travels with it and only ever set together. */
  version?: string;
  /** Bumped on every previewPath call; keys the isolated HTML iframe so re-opening the
   *  same path remounts it and refetches fresh content (its src alone would not change). */
  nonce: number;
}

/** Monotonic counter behind Preview.nonce. Doubles as the staleness guard: previewPath
 *  captures its value up front and publishes only while still the latest, so two rapid
 *  calls can't have the slower loser overwrite the winner. Module scope is fine — the
 *  panel mounts one browser per conversation on screen. */
let previewSeq = 0;

/**
 * Unsaved editor drafts by Session and path, kept for the app's lifetime and written through
 * on every keystroke. Hiding the panel or its dock keeps this component mounted, draft and
 * all; what the map is for are the paths no confirm dialog can intercept, where the body
 * really is unmounted — a tab dragged to the other edge, a Session switched from the
 * sidebar. The draft outlives the component: opening the same file again reopens the
 * editor on it.
 */
const unsavedDrafts = new Map<string, string>();
const draftKey = (sessionId: string, path: string): string => `${sessionId}\n${path}`;

/**
 * Reads a file as text, bounded to TEXT_PREVIEW_LIMIT bytes: the body is read as a stream
 * and cancelled past the cap, so a large log never downloads whole for a preview. With
 * `sniff`, the first chunk decides whether the file is text at all — null means it is not,
 * and nothing more of it is read. A response with no stream is thrown on rather than read
 * whole: `arrayBuffer()` would pull the entire file into memory, which is the one thing the
 * cap exists to prevent.
 *
 * The version marker is read alongside the bytes and is required: it is what the editor
 * saves against, and a response that carries content without it could only mean the
 * endpoint is broken — better a thrown read than a save with no precondition.
 */
async function fetchTextPreview(
  url: string,
  sniff: boolean,
): Promise<{ content: string; truncated: boolean; version: string } | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  if (res.body === null) throw new Error("no response body");
  const version = res.headers.get("etag");
  if (version === null) throw new Error("no version header");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (chunks.length === 0 && sniff && !looksLikeText(value.subarray(0, SNIFF_BYTES))) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
    total += value.length;
    if (total > TEXT_PREVIEW_LIMIT) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const truncated = total > TEXT_PREVIEW_LIMIT;
  const shown = truncated ? utf8Complete(bytes.subarray(0, TEXT_PREVIEW_LIMIT)) : bytes;
  return { content: new TextDecoder().decode(shown), truncated, version };
}

/**
 * The file's current version marker, without downloading it: the body is cancelled as soon
 * as the headers land. Null when the read did not get that far — the file is gone, or the
 * request failed; the caller says nothing in that case, because the save's own precondition
 * is what actually protects the file.
 */
async function fetchFileVersion(url: string): Promise<string | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  await res.body?.cancel();
  return res.ok ? res.headers.get("etag") : null;
}

/** The content endpoint's payload: the base64 body of a data URL. A string Blob encodes as UTF-8, which is what a saved text file must be. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The tree row under a pointer, read off the row's data attributes — the drop hit test and
 * the context menu both resolve their target this way rather than through a handler per row,
 * which a tree of hundreds of rows cannot afford. The element travels with the answer because
 * the menu anchors and returns focus to it.
 */
function hitRow(
  target: EventTarget | null,
): { kind: "dir" | "file"; path: string; el: HTMLElement } | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>("[data-tree-path]");
  if (row === null) return null;
  const kind = row.dataset.treeKind;
  const path = row.dataset.treePath;
  return (kind === "dir" || kind === "file") && path !== undefined ? { kind, path, el: row } : null;
}

/** A selection the preview offered to the conversation, with the source lines it covers when they could be resolved. */
interface PreviewSelection {
  text: string;
  fromLine?: number;
  toLine?: number;
  /**
   * The selected range itself, cloned at the gesture. Handing the block to the composer
   * focuses its textarea, and focusing a text field drops whatever the document had
   * selected — so the highlight has to be put back by hand afterwards (restoreSelection).
   */
  range: Range;
}

/**
 * Puts `range` back as the document's one selection, a frame after the caller hands text to
 * the composer: the composer focuses its textarea inside a requestAnimationFrame of its own,
 * scheduled first, and that focus is what clears the selection this restores.
 *
 * A range whose ends have since left the document is dropped rather than re-applied — the
 * preview it was read from is no longer on screen, and re-selecting detached nodes would
 * either throw or select nothing.
 */
function restoreSelection(range: Range): void {
  requestAnimationFrame(() => {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return;
    const selection = window.getSelection();
    if (selection === null) return;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

/**
 * The text selected inside `host`, or null when there is none, when it lies elsewhere on the
 * page, or when it is only whitespace. `lines` are the rendered source lines to measure the
 * range against — empty for the rendered Markdown and HTML views, which have no line
 * structure to honestly report, so those give up the range and keep the text.
 */
function readSelection(
  host: HTMLElement | null,
  lines: readonly HTMLElement[],
): PreviewSelection | null {
  if (host === null) return null;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString();
  if (text.trim() === "") return null;
  // Cloned, not held: the live range moves with the selection, and the selection is about to
  // be cleared by the composer taking focus.
  const captured = range.cloneRange();
  // Which lines the range actually touches, asked of the DOM rather than inferred from the
  // text: a selection that starts or ends on a line boundary lands on a node between the line
  // spans, where walking up from the boundary finds no line at all.
  let from = -1;
  let to = -1;
  for (const [i, line] of lines.entries()) {
    if (!range.intersectsNode(line)) continue;
    if (from < 0) from = i;
    to = i;
  }
  return from < 0
    ? { text, range: captured }
    : { text, range: captured, fromLine: from + 1, toLine: to + 1 };
}

/**
 * A drop's files, with dropped folders held out: the browser puts a directory into
 * `dataTransfer.files` as an unreadable pseudo-file, so uploading one gets as far as the
 * overwrite confirmation and then dies on a read error with nothing to say. Reading the
 * entries is the only way to tell the two apart; a browser that hands over no items at all
 * falls back to the plain file list.
 */
function pickDroppedFiles(data: DataTransfer): { files: File[]; dirs: string[] } {
  const files: File[] = [];
  const dirs: string[] = [];
  for (let i = 0; i < data.items.length; i += 1) {
    const item = data.items[i]!;
    const file = item.getAsFile();
    if (item.webkitGetAsEntry()?.isDirectory === true) {
      if (file !== null) dirs.push(file.name);
    } else if (file !== null) {
      files.push(file);
    }
  }
  return files.length + dirs.length > 0 ? { files, dirs } : { files: [...data.files], dirs };
}

/** ArrowLeft / ArrowRight on the focused divider, in px: coarse enough to get somewhere, fine enough to land. */
const TREE_WIDTH_STEP = 16;

/**
 * A breadcrumb item's rendered width, approximated: the toolbar has no text metrics to
 * measure against, so one character at the toolbar's text size costs CRUMB_CHAR_PX (a
 * wide character — CJK, full-width punctuation — two of those) and the item itself costs
 * its padding plus the separator drawn before it. Erring wide is the safe direction: it
 * collapses one segment early rather than letting the row outgrow its space.
 */
const CRUMB_CHAR_PX = 7;
const CRUMB_ITEM_PX = 16;
const WIDE_CHAR_RE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

function crumbItemWidth(text: string): number {
  let cells = 0;
  for (const ch of text) cells += WIDE_CHAR_RE.test(ch) ? 2 : 1;
  return CRUMB_ITEM_PX + cells * CRUMB_CHAR_PX;
}

/**
 * The panel's actions, with their names taken off them: a square the size of the tree toggle, drawn in
 * the toolbar and in the preview header alike so the panel's two rows of marks line up. A
 * control with no visible text needs its name in two places to be readable at all — the
 * element's own `aria-label`, and the Tooltip it is wrapped in.
 */
const iconActionBase =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150";
const iconActionIdle =
  "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";
const iconActionClass = `${iconActionBase} ${iconActionIdle}`;

/** The same square, as a toggle: pressed is a filled resting state, not a hover that happens to stick. */
const iconToggleClass = (on: boolean): string =>
  `${iconActionBase} ${on ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100" : iconActionIdle}`;

export function WorkspaceBrowser({
  session,
  openRequest,
  active,
  reloadSignal,
  onInsertReference,
}: {
  session: SessionInfo;
  /** External navigation command (from clicking a file chip in a message): opens the tree
   *  down to that path and previews it. Triggers again whenever the object reference changes,
   *  even if path is the same as last time (clicking the same file again must still re-locate it). */
  openRequest?: { path: string } | null;
  /** Whether the panel is on screen — false for a covered tab and for a hidden dock, both of
   *  which keep the component mounted (at width 0) with everything it holds. The tree can go
   *  stale as the Agent writes files while it is away, so a refresh is issued right at the
   *  moment it transitions from hidden to visible. */
  active?: boolean;
  /**
   * Bumped by the parent every time a Task settles on this session: the turn that just ended
   * is exactly when the Agent's writes land, so the tree — and whatever file is open in
   * the preview — is stale the moment it does. Any change of the number means "re-read",
   * so the initial value is irrelevant and no edge tracking is needed.
   */
  reloadSignal?: number;
  /**
   * Puts a Workspace reference into the conversation's composer at its caret — the context
   * menu's "add to conversation". The panel composes the text (a `@path`, or a fenced block
   * around a preview selection) and says how it should sit; where the caret is, and what is
   * already typed around it, are the composer's own business.
   */
  onInsertReference: (snippet: string, layout: InsertLayout) => void;
}) {
  // Whether the HTML preview lands on a separate origin. True routes both the in-app
  // rendered view and "open in new tab" through the preview origin; false downgrades
  // the new tab to the same-origin sandbox (which the link flags rather than failing
  // silently in the page) and the in-app rendered view to the srcDoc fallback.
  const { previewIsolated } = useAuth();
  const previewIsolatedRef = useRef(previewIsolated);
  previewIsolatedRef.current = previewIsolated;
  const sessionId = session.sessionId;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // ------------------------------------------------------------------------------- tree
  const [listings, setListings] = useState<Listings>(() => new Map());
  /** Open directories (the root is always open and never listed here). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [rootError, setRootError] = useState<string | null>(null);
  /** The directory the breadcrumbs name and uploads land in: the selected file's, or the last folder clicked. */
  const [currentDir, setCurrentDir] = useState("");
  /** The file chosen in the tree; the preview follows it once loaded. */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ path: string } | null>(null);
  /** The search box's text. Deliberately not persisted: a filter is a thing you are doing, not a setting. */
  const [query, setQuery] = useState("");
  /** The directory last opened or closed, so the tree animates exactly that subtree once. */
  const [toggled, setToggled] = useState<TreeToggle | null>(null);
  // -------------------------------------------------------------------- preview / editor
  const [preview, setPreview] = useState<Preview | null>(null);
  /** HTML / Markdown preview: rendered view (HTML via sandboxed iframe, Markdown via md-body) / source toggle. */
  const [richView, setRichView] = useState<"rendered" | "source">("rendered");
  /** Error from the lazy source fetch of an isolated HTML preview: scoped to the source
   *  view — the rendered iframe keeps working no matter what happens to this fetch. */
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState(false);
  /** A save the server refused because the file had changed (non-null shows the conflict dialog). */
  const [conflict, setConflict] = useState<{ name: string } | null>(null);
  /** The open "discard unsaved changes?" question, resolving with the answer. */
  const [discardPrompt, setDiscardPrompt] = useState<{ resolve: (ok: boolean) => void } | null>(
    null,
  );
  // ------------------------------------------------------------------------ upload / drop
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  /** Picked files whose names collide with the target directory's listing (non-null shows the overwrite confirm). */
  const [pendingUpload, setPendingUpload] = useState<{
    files: File[];
    clashes: string[];
    dir: string;
  } | null>(null);
  const [drag, setDrag] = useState<{ active: boolean; targetDir: string }>({
    active: false,
    targetDir: "",
  });
  // ----------------------------------------------------------------------------- chrome
  const [treeVisible, setTreeVisible] = useState(() => readTreeVisible());
  /**
   * True for the length of the show/hide transition and only then. The pane's width is also
   * the panel's own size talking — dragging the divider, or the dock's edge, moves it too —
   * and a transition left permanently on would make those drags lag a fifth of a second
   * behind the pointer. The toggle arms it; the timer below disarms it.
   */
  const [treeSliding, setTreeSliding] = useState(false);
  /** The dragged tree width, or null while the user has never dragged it (the computed default stands). */
  const [treeWidthPref, setTreeWidthPref] = useState<number | null>(() => readTreeWidth());
  const [resizingTree, setResizingTree] = useState(false);
  /** Soft wrap, shared by the source view and the editor so Edit reflows nothing (see parseWrapLines). */
  const [wrapLines, setWrapLines] = useState(() => readWrapLines());
  /**
   * The preview header's copy action. Driven by the hook rather than a plain CopyButton
   * because the tooltip is a Tooltip panel here, not a `title`, and a trigger may carry only
   * one of the two — the glyph swap and the live region are the ones copy-button.tsx owns.
   */
  const { copied, flash: flashCopy } = useCopied();
  const [width, setWidth] = useState(0);
  /** The breadcrumb strip's own width: it is `flex-1` over a zero basis, so it measures the space left by the actions and never its own content — no feedback loop. */
  const [crumbsWidth, setCrumbsWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const treePaneRef = useRef<HTMLDivElement | null>(null);
  const crumbsRef = useRef<HTMLDivElement | null>(null);
  // ----------------------------------------------------------------------- context menus
  // One hook per surface, not per row: each carries a long-press timer, and the tree draws
  // hundreds of rows — twice over while a closing subtree animates out. The row a gesture
  // landed on is resolved from the event instead, and held here for as long as its menu is up.
  const treeMenu = useRowContextMenu();
  const [treeMenuTarget, setTreeMenuTarget] = useState<FileMenuTarget | null>(null);
  const previewMenu = useRowContextMenu();
  /** The selection the preview's menu was opened over; null when there was none inside it. */
  const [menuSelection, setMenuSelection] = useState<PreviewSelection | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  /** The directory the menu's own picker uploads into (the toolbar's picker always means the current one). */
  const menuUploadDir = useRef("");
  const menuUploadRef = useRef<HTMLInputElement | null>(null);

  // Mirrors for the async flows and stable callbacks below, which must read the latest
  // value without re-creating themselves on every change.
  const listingsRef = useRef(listings);
  listingsRef.current = listings;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const currentDirRef = useRef(currentDir);
  currentDirRef.current = currentDir;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const richViewRef = useRef(richView);
  richViewRef.current = richView;
  const uploadingRef = useRef(uploading);
  uploadingRef.current = uploading;
  /** Newest request per directory: only it may publish, so a slow older listing cannot overwrite a newer one. */
  const dirSeq = useRef(new Map<string, number>());

  // Session switched: back to a fresh root with no preview. Reset during render (React's
  // documented "adjust state when a prop changes" pattern), not in an effect — an
  // effect-based reset lets one frame commit in which the old session's preview renders
  // against the new session, flipping the isolated iframe's src to the new session + the
  // old path and firing a doomed request. Bumping previewSeq also invalidates any
  // in-flight previewPath from the old session (its present() guard fails). An editor
  // draft survives in unsavedDrafts and comes back when the file is opened again.
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId);
  if (renderedSessionId !== sessionId) {
    setRenderedSessionId(sessionId);
    setListings(new Map());
    setExpanded(new Set());
    setLoadingDirs(new Set());
    setRootError(null);
    setCurrentDir("");
    setSelectedPath(null);
    setScrollTo(null);
    setQuery("");
    setToggled(null);
    setPreview(null);
    setSourceError(null);
    setEditor(null);
    setSaveConfirm(false);
    setConflict(null);
    setDiscardPrompt(null);
    // The upload and save flows finish against the Session they captured and skip their own
    // state updates once it is no longer the one on screen — so the chrome they left behind
    // has to be cleared here, or an "Uploading 2/5…" label and its disabled picker outlive
    // the Session forever. A staged overwrite confirmation is dropped for the same reason:
    // answering it after the switch would upload the old Session's files into this one.
    setUploading(null);
    setPendingUpload(null);
    setSaving(false);
    // An open menu points at a path in the Session that just left; its actions would run
    // against this one.
    treeMenu.close();
    previewMenu.close();
    setTreeMenuTarget(null);
    setMenuSelection(null);
    previewSeq++;
  }

  // ------------------------------------------------------------------ measured layout
  // The panel's own width decides the layout: a viewport breakpoint cannot know how much of
  // the window the dock was given. Measured in a layout effect so the first paint is right.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const narrow = isNarrowLayout(width);

  // The breadcrumb strip is measured separately: how much room it has is what the
  // toolbar's actions leave over, which the panel's own width does not say.
  useLayoutEffect(() => {
    const el = crumbsRef.current;
    if (!el) return;
    const measure = () => setCrumbsWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The tree pane's width: dragged if it ever was, otherwise the computed default, and
  // either way within the bounds this panel width allows.
  const treeWidth = clampTreeWidth(treeWidthPref ?? defaultTreeWidth(width), width);
  const treeWidthRef = useRef(treeWidth);
  treeWidthRef.current = treeWidth;

  // The show/hide transition's window: the toggle arms it, this disarms it once the slide
  // has played (toggling again mid-slide restarts the timer). DOCK_TRANSITION_MS is the
  // dock's own expand/collapse duration — the pane moves with the same motion — and the
  // duration-200 class on the sliding container has to match it.
  useEffect(() => {
    if (!treeSliding) return;
    const timer = window.setTimeout(() => setTreeSliding(false), DOCK_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [treeSliding, treeVisible]);

  // --------------------------------------------------------------------------- loading

  /**
   * Fetches one directory's listing into the tree. Resolves true when it published; false
   * when it failed or was superseded (a newer request for the same directory, or a Session
   * switch). The root's failure shows in the tree; a nested directory that fails to list
   * (deleted mid-turn) toasts and leaves the tree.
   */
  const loadDir = useCallback(
    async (dir: string): Promise<boolean> => {
      const sid = sessionId;
      const seq = (dirSeq.current.get(dir) ?? 0) + 1;
      dirSeq.current.set(dir, seq);
      const current = () => sessionIdRef.current === sid && dirSeq.current.get(dir) === seq;
      setLoadingDirs((s) => new Set(s).add(dir));
      try {
        const res = await api.listWorkspaceFiles(sid, dir);
        if (!current()) return false;
        setListings((m) => new Map(m).set(dir, res.entries));
        if (dir === "") setRootError(null);
        return true;
      } catch (err) {
        if (!current()) return false;
        const text = err instanceof ApiError ? err.message : S.files.loadFailed;
        if (dir === "") {
          setRootError(text);
        } else {
          toastError(text);
          setListings((m) => {
            if (!m.has(dir)) return m;
            const next = new Map(m);
            next.delete(dir);
            return next;
          });
          setExpanded((s) => withExpanded(s, dir, false));
        }
        return false;
      } finally {
        if (current()) {
          setLoadingDirs((s) => {
            const next = new Set(s);
            next.delete(dir);
            return next;
          });
        }
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void loadDir("");
  }, [loadDir]);

  /** Re-reads everything on screen: the root and every open directory that has a listing. */
  const refreshAll = useCallback(() => {
    void loadDir("");
    for (const dir of expandedRef.current) {
      if (dir !== "" && listingsRef.current.has(dir)) void loadDir(dir);
    }
  }, [loadDir]);

  // Edge-triggered refresh on the panel's hidden -> visible transition (doesn't count the
  // initial mount: mounting itself already fetches once).
  const prevActive = useRef(active);
  useEffect(() => {
    if (active && !prevActive.current) refreshAll();
    prevActive.current = active;
  }, [active, refreshAll]);

  // --------------------------------------------------------------------------- preview

  /**
   * Loads `filePath` into the preview. `refresh` re-reads a file already on screen (the
   * settled-turn refresh below): it must not touch the things that belong to the user's
   * hands — the rendered/source choice — and a failed re-read leaves what is on screen
   * alone instead of replacing a working preview with "unsupported".
   */
  const previewPath = useCallback(
    async (filePath: string, opts?: { refresh?: boolean }) => {
      const refresh = opts?.refresh === true;
      const sid = sessionId;
      const name = baseName(filePath);
      const kind = previewKindFor(name);
      const nonce = ++previewSeq;
      /** Publishes this call's result unless a newer previewPath call has started since:
       *  two rapid calls interleave across the await, and the late loser must not
       *  overwrite the winner's preview. */
      const present = (p: Preview) => {
        if (nonce === previewSeq && sessionIdRef.current === sid) setPreview(p);
      };
      if (!refresh) {
        setRichView("rendered");
        setSourceError(null);
      }
      if (kind === "image") {
        present({ path: filePath, name, kind: "image", nonce });
        return;
      }
      // PDF: the server returns it inline as application/pdf, embedded directly in an iframe and rendered by the browser.
      if (kind === "pdf") {
        present({ path: filePath, name, kind: "pdf", nonce });
        return;
      }
      // Isolated HTML: the rendered view is an iframe onto the preview origin and needs no
      // text here, so the iframe mounts with no upfront fetch — a large file isn't
      // downloaded twice, and a transient fetch failure can't downgrade a page the iframe
      // would serve fine. The source text is fetched lazily on the first Source toggle
      // (see the effect below).
      if (kind === "html" && previewIsolatedRef.current) {
        present({ path: filePath, name, kind: "html", nonce });
        return;
      }
      try {
        // The server downgrades html/svg served inline to text/plain (a same-origin XSS
        // defense); this fetches the raw content back for text/Markdown previews and for
        // the srcDoc fallback rendered view of non-isolated HTML. A name that says nothing
        // about the type is sniffed: text opens as text, anything else stays a download.
        const result = await fetchTextPreview(
          api.workspaceFileUrl(sid, filePath),
          kind === "unknown",
        );
        if (result === null) {
          if (!refresh) present({ path: filePath, name, kind: "unsupported", nonce });
          return;
        }
        const { content, truncated, version } = result;
        // Oversized Markdown defaults to the source view (benefiting from the unhighlighted
        // highlight=false path): feeding the whole block to remark for parsing is a one-time
        // main-thread cost; the user can still manually switch to "rendered view" as an informed choice.
        if (!refresh && kind === "md" && content.length > HIGHLIGHT_LIMIT && nonce === previewSeq) {
          setRichView("source");
        }
        present({
          path: filePath,
          name,
          kind: kind === "html" ? "html" : kind === "md" ? "md" : "text",
          content,
          truncated,
          version,
          nonce,
        });
        // A draft left behind on this file (see unsavedDrafts) reopens the editor on it.
        if (
          !refresh &&
          !truncated &&
          nonce === previewSeq &&
          sessionIdRef.current === sid &&
          editorRef.current?.path !== filePath
        ) {
          const key = draftKey(sid, filePath);
          const stashed = unsavedDrafts.get(key);
          if (stashed === content) unsavedDrafts.delete(key);
          else if (stashed !== undefined) {
            setEditor({ path: filePath, baseline: content, draft: stashed, version });
            toastInfo(S.files.unsavedRestored(name));
          }
        }
      } catch {
        // A re-read that fails (the Agent deleted the file mid-turn, a blip) keeps the
        // preview the user is looking at; only a fresh open reports it as unsupported.
        if (!refresh) present({ path: filePath, name, kind: "unsupported", nonce });
      }
    },
    [sessionId],
  );

  // Lazy source fetch for isolated HTML previews: previewPath mounted the iframe without
  // downloading the text, so the first switch to the Source view fetches it here (as does
  // the rare case of previewIsolated flipping to false with such a preview open, which
  // strands the srcDoc fallback without content). Failure sets sourceError and touches
  // nothing else — a broken source fetch must not take down the rendered view.
  useEffect(() => {
    if (preview?.kind !== "html" || preview.content !== undefined) return;
    if (richView !== "source" && previewIsolated) return;
    const target = preview.path;
    let cancelled = false;
    setSourceError(null);
    void (async () => {
      try {
        const result = await fetchTextPreview(api.workspaceFileUrl(sessionId, target), false);
        if (cancelled || result === null) return;
        // Functional update with its own guard (not `present`): this must only fill the
        // still-current, still-contentless HTML preview for the same path, never revive
        // a preview the user has since navigated away from.
        setPreview((p) =>
          p !== null && p.kind === "html" && p.path === target && p.content === undefined
            ? {
                ...p,
                content: result.content,
                truncated: result.truncated,
                version: result.version,
              }
            : p,
        );
      } catch {
        if (!cancelled) setSourceError(S.files.loadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, richView, previewIsolated, sessionId]);

  // -------------------------------------------------------------- navigation and guards

  const promptDiscard = useCallback(
    () => new Promise<boolean>((resolve) => setDiscardPrompt({ resolve })),
    [],
  );

  const discardEditor = useCallback(() => {
    const current = editorRef.current;
    if (current !== null) unsavedDrafts.delete(draftKey(sessionIdRef.current, current.path));
    setEditor(null);
  }, []);

  /**
   * Runs `action` unless it would abandon typed changes, in which case the user is asked
   * first and a "keep editing" answer drops the action. `nextPath` is the file the action
   * lands on (null: none); landing on the file being edited keeps the editor as it is, and
   * a clean editor simply closes.
   */
  const navigateGuarded = useCallback(
    async (nextPath: string | null, action: () => void) => {
      const current = editorRef.current;
      if (needsDiscardConfirm(current, nextPath)) {
        if (!(await promptDiscard())) return;
        discardEditor();
      } else if (current !== null && current.path !== nextPath) {
        setEditor(null);
      }
      action();
    },
    [promptDiscard, discardEditor],
  );

  /**
   * Opens every directory above `path` and makes sure each is listed — the file's own
   * directory re-read, since a located file was most likely just written and its cached
   * listing predates it — then scrolls the row into view.
   */
  const locate = useCallback(
    async (path: string) => {
      setExpanded((s) => expandTo(s, path));
      const dir = parentDir(path);
      await Promise.all(
        ancestorDirs(path).map((d) =>
          d === dir || !listingsRef.current.has(d) ? loadDir(d) : Promise.resolve(true),
        ),
      );
      if (sessionIdRef.current === sessionId) setScrollTo({ path });
    },
    [loadDir, sessionId],
  );

  /** Selects a file in the tree and previews it; `locate` additionally loads the way down to it (an external open request). */
  const openFile = useCallback(
    (path: string, opts?: { locate?: boolean }) => {
      void navigateGuarded(path, () => {
        setSelectedPath(path);
        setCurrentDir(parentDir(path));
        if (opts?.locate) void locate(path);
        else setExpanded((s) => expandTo(s, path));
        void previewPath(path);
      });
    },
    [navigateGuarded, locate, previewPath],
  );

  // The same settled-turn signal re-reads whatever is open in the preview: watching a file
  // the Agent is editing is the reason this panel sits next to the conversation. Skipped on
  // the first run (the mount already read it) and while no preview is open. Reading the path
  // from a ref keeps this effect keyed on the signal alone.
  //
  // The file being edited is still not re-read — that would put the Agent's text under the
  // user's hands. It is version-checked instead: the save can no longer clobber the Agent's
  // write, but silence until then would leave the user typing into a file that has already
  // moved, so the editor says so as soon as the turn lands.
  const lastReloadSignal = useRef(reloadSignal);
  useEffect(() => {
    if (reloadSignal === lastReloadSignal.current) return;
    lastReloadSignal.current = reloadSignal;
    refreshAll();
    const open = previewRef.current?.path ?? null;
    if (open === null) return;
    const editing = editorRef.current;
    if (editing?.path !== open) {
      void previewPath(open, { refresh: true });
      return;
    }
    const sid = sessionIdRef.current;
    void (async () => {
      try {
        const version = await fetchFileVersion(api.workspaceFileUrl(sid, open));
        if (version === null) return;
        // Compared against the editor as it stands now, not the one captured above: it may
        // have been closed and reopened on the Agent's own version while this was in flight,
        // and that editor is not stale.
        setEditor((e) =>
          e !== null && e.path === open && e.version !== version && sessionIdRef.current === sid
            ? { ...e, changedOnDisk: true }
            : e,
        );
      } catch {
        // A failed probe says nothing; the save's precondition is the guarantee.
      }
    })();
  }, [reloadSignal, refreshAll, previewPath]);

  // External navigation command (clicking a file chip in a message / a file card): opens
  // the tree down to the target and previews it.
  //
  // Each openRequest object is handled exactly once (the ref guard): this effect also
  // re-runs when openFile's identity changes with the session, at which point openRequest
  // is still the OLD session's request — the parent clears it only after child effects.
  // Replaying it against the new session would resurrect the preview the session-switch
  // reset just cleared. The parent creates a fresh object per click, so re-clicking the
  // same file still re-triggers.
  const handledOpenRequest = useRef<{ path: string } | null>(null);
  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    openFile(openRequest.path, { locate: true });
  }, [openRequest, openFile]);

  // Unsaved changes: the browser's leave-page prompt (reload, tab close — the only text the
  // browser shows is its own), and the dock's close guard for the tab's ×, the one gesture
  // that unmounts this body. Hiding the panel's dock only puts the surface away, draft and
  // all, so it asks nothing.
  const dirty = isDirty(editor);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older engines show the prompt only for a set returnValue.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const key = tabKey({ kind: "panel", panel: "workspace" });
    setCloseGuard(key, async () => {
      const ok = await promptDiscard();
      if (ok) discardEditor();
      return ok;
    });
    return () => setCloseGuard(key, null);
  }, [dirty, promptDiscard, discardEditor]);

  // ------------------------------------------------------------------ tree interactions

  /** Opens or closes a directory and makes it the current one; a first open fetches its listing. */
  const toggleDir = useCallback(
    (dir: string) => {
      setCurrentDir(dir);
      const open = !expandedRef.current.has(dir);
      setExpanded((s) => withExpanded(s, dir, open));
      // The subtree this toggle moves is the one that animates. The serial makes toggling the
      // same directory again a new event; the mark stands until the next toggle, since an
      // opening directory's rows may arrive with the listing rather than in this commit.
      setToggled((last) => ({ dir, open, serial: (last?.serial ?? 0) + 1 }));
      if (open && !listingsRef.current.has(dir)) void loadDir(dir);
    },
    [loadDir],
  );

  /**
   * A directory row's click while the search box holds a query. Every listed directory is
   * already shown open there, so a click cannot mean "collapse this" — it makes the
   * directory current and, when it has never been listed, lists it, which is how the search
   * is extended past what the tree has loaded so far.
   */
  const openDirForFilter = useCallback(
    (dir: string) => {
      setCurrentDir(dir);
      setExpanded((s) => withExpanded(s, dir, true));
      if (!listingsRef.current.has(dir)) void loadDir(dir);
    },
    [loadDir],
  );

  const backToTree = (): void => {
    void navigateGuarded(null, () => {
      setSelectedPath(null);
      setPreview(null);
    });
  };

  const setTree = (visible: boolean): void => {
    setTreeVisible(visible);
    setTreeSliding(true);
    writeTreeVisible(visible);
  };

  const setWrap = (wrap: boolean): void => {
    setWrapLines(wrap);
    writeWrapLines(wrap);
  };

  // ------------------------------------------------------------------------- tree width
  // The divider between the two panes. The width follows the pointer against the tree
  // pane's own left edge rather than an accumulated delta, so a drag that outruns the
  // clamp comes back in step instead of offset by however far it overshot.
  const treeResizeProps = usePointerDrag<object>({
    threshold: 0,
    begin: (event) => {
      event.preventDefault(); // no text selection while the divider is dragged
      setResizingTree(true);
      return {};
    },
    onMove: (event) => {
      const rect = treePaneRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTreeWidthPref(clampTreeWidth(event.clientX - rect.left, width));
    },
    onEnd: () => {
      setResizingTree(false);
      writeTreeWidth(treeWidthRef.current); // once per drag, not per frame
    },
    onCancel: () => setResizingTree(false),
  });

  const onDividerKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const delta =
      e.key === "ArrowLeft" ? -TREE_WIDTH_STEP : e.key === "ArrowRight" ? TREE_WIDTH_STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = clampTreeWidth(treeWidthRef.current + delta, width);
    setTreeWidthPref(next);
    writeTreeWidth(next);
  };

  // ----------------------------------------------------------------------------- editing

  const startEdit = async (): Promise<void> => {
    const current = previewRef.current;
    if (current === null || !canEditPreview(current)) return;
    // Content and version are read together and stored together, so one missing means both
    // are: an isolated HTML preview mounted without its text. Read it now, and refuse a
    // file the bounded read cannot hold whole — saving a partial text back would truncate
    // the file.
    let content = current.content;
    let version = current.version;
    if (content === undefined || version === undefined) {
      try {
        const result = await fetchTextPreview(api.workspaceFileUrl(sessionId, current.path), false);
        if (result === null || result.truncated) {
          toastError(S.files.editTooLarge(TEXT_PREVIEW_LIMIT / 1024));
          return;
        }
        ({ content, version } = result);
        setPreview((p) =>
          p !== null && p.path === current.path
            ? { ...p, content: result.content, truncated: false, version: result.version }
            : p,
        );
      } catch {
        toastError(S.files.loadFailed);
        return;
      }
    }
    if (previewRef.current?.path !== current.path) return;
    setEditor({ path: current.path, baseline: content, draft: content, version });
  };

  const updateDraft = (draft: string): void => {
    const current = editorRef.current;
    if (current === null) return;
    setEditor({ ...current, draft });
    const key = draftKey(sessionId, current.path);
    if (draft === current.baseline) unsavedDrafts.delete(key);
    else unsavedDrafts.set(key, draft);
  };

  const requestSave = (): void => {
    const current = editorRef.current;
    if (current === null || saving) return;
    if (!isDirty(current)) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    // Already known to have moved under the editor: the ordinary "the file will be
    // overwritten" confirmation understates that, so ask the conflict question instead —
    // and sending the stale precondition first would only earn the same dialog a round
    // trip later.
    if (current.changedOnDisk === true) setConflict({ name: baseName(current.path) });
    else setSaveConfirm(true);
  };

  /**
   * Writes the draft back. The save carries the version the editor opened with, so the
   * server refuses it (409) if the file has been rewritten since — the conflict dialog then
   * offers `overwrite`, which is the same write with no precondition. The draft is never
   * dropped on a refusal: the editor stays exactly as the user left it.
   */
  const save = async (opts?: { overwrite?: boolean }): Promise<void> => {
    setSaveConfirm(false);
    setConflict(null);
    const current = editorRef.current;
    if (current === null) return;
    const blob = new Blob([current.draft]);
    if (blob.size > WORKSPACE_UPLOAD_LIMIT_MB * MB_BYTES) {
      toastError(S.files.saveTooLarge(WORKSPACE_UPLOAD_LIMIT_MB));
      return;
    }
    const sid = sessionId;
    setSaving(true);
    try {
      await api.uploadWorkspaceFile(
        sid,
        current.path,
        await blobToBase64(blob),
        opts?.overwrite ? undefined : current.version,
      );
      if (sessionIdRef.current !== sid) return;
      unsavedDrafts.delete(draftKey(sid, current.path));
      setEditor(null);
      // The preview now shows what was written; a fresh nonce remounts an HTML iframe onto it.
      // The bytes are known, the version the write produced is not — it is dropped rather
      // than kept at its pre-save value, which would make the next Edit save against a
      // version the file has already left. startEdit re-reads when it finds none.
      const nonce = ++previewSeq;
      setPreview((p) =>
        p !== null && p.path === current.path
          ? { ...p, content: current.draft, truncated: false, version: undefined, nonce }
          : p,
      );
      const dir = parentDir(current.path);
      setListings((m) =>
        upsertEntry(m, dir, {
          name: baseName(current.path),
          kind: "file",
          sizeBytes: blob.size,
          mtime: new Date().toISOString(),
        }),
      );
      void loadDir(dir);
      toastSuccess(S.common.saved);
    } catch (err) {
      if (sessionIdRef.current !== sid) return;
      // The write precondition refused it: the file is no longer the one that was opened.
      // Ask rather than report — overwriting is a legitimate answer, it just has to be the
      // user's, and neither answer costs them their text.
      if (err instanceof ApiError && err.code === "file_changed") {
        setEditor((e) => (e === null ? e : { ...e, changedOnDisk: true }));
        setConflict({ name: baseName(current.path) });
        return;
      }
      toastError(apiErrorText(err));
    } finally {
      if (sessionIdRef.current === sid) setSaving(false);
    }
  };

  const cancelEdit = (): void => {
    void navigateGuarded(null, () => undefined);
  };

  // ------------------------------------------------------------------------------ upload

  const doUpload = async (files: File[], dir: string): Promise<void> => {
    const sid = sessionId;
    setUploading({ done: 0, total: files.length });
    const uploaded: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        const b64 = await blobToBase64(file);
        await api.uploadWorkspaceFile(sid, joinWorkspacePath(dir, file.name), b64);
        if (sessionIdRef.current !== sid) return;
        uploaded.push(file.name);
        // The row appears as each file lands; the listing is re-read afterwards for the
        // server's own size and time.
        setListings((m) =>
          upsertEntry(m, dir, {
            name: file.name,
            kind: "file",
            sizeBytes: file.size,
            mtime: new Date().toISOString(),
          }),
        );
        setUploading({ done: i + 1, total: files.length });
      }
      toastSuccess(S.files.uploadedCount(uploaded.length));
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      if (sessionIdRef.current === sid) setUploading(null);
    }
    if (sessionIdRef.current !== sid || uploaded.length === 0) return;
    setExpanded((s) => withExpanded(s, dir, true));
    void loadDir(dir);
    // The first uploaded file opens, unless the editor holds typed changes — an upload is
    // no reason to ask about those.
    if (!isDirty(editorRef.current)) openFile(joinWorkspacePath(dir, uploaded[0]!));
  };

  /**
   * Size-checks a picked or dropped batch against the endpoint's ceiling (oversize files are
   * named and skipped, nothing is uploaded to earn the refusal), then confirms overwrites:
   * names already present in the target directory — listed on demand, so the check is
   * against the real directory, not a stale or missing listing.
   */
  const stageUpload = async (picked: File[], dir: string): Promise<void> => {
    if (uploadingRef.current !== null) return;
    const { accepted, rejected } = splitBySize(picked, WORKSPACE_UPLOAD_LIMIT_MB);
    if (rejected.length > 0) {
      toastError(
        S.files.uploadTooLarge(rejected.map((f) => f.name).join(", "), WORKSPACE_UPLOAD_LIMIT_MB),
      );
    }
    if (accepted.length === 0) return;
    const sid = sessionId;
    if (!listingsRef.current.has(dir) && !(await loadDir(dir))) return;
    if (sessionIdRef.current !== sid) return;
    const existing = new Set((listingsRef.current.get(dir) ?? []).map((entry) => entry.name));
    const clashes = accepted.filter((f) => existing.has(f.name)).map((f) => f.name);
    if (clashes.length > 0) setPendingUpload({ files: accepted, clashes, dir });
    else void doUpload(accepted, dir);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (files.length > 0) void stageUpload(files, currentDirRef.current);
  };

  /** The menu's own picker: same staging, but into the folder that was right-clicked. */
  const onMenuPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (files.length > 0) void stageUpload(files, menuUploadDir.current);
  };

  // ------------------------------------------------------------------------ context menus

  const copyPath = (target: FileMenuTarget): void => {
    // A menu row cannot carry the copy button's own at-the-control feedback: the row acts and
    // the panel closes out from under it. A toast is the confirmation that survives that, and
    // it says the same word (sidebar.tsx's copy-id row does the same).
    writeClipboard(target.path);
    toastSuccess(S.common.copied);
  };

  const addToChat = (target: FileMenuTarget): void => {
    onInsertReference(pathReference(target.path, target.kind), "inline");
  };

  const uploadInto = (dir: string): void => {
    menuUploadDir.current = dir;
    menuUploadRef.current?.click();
  };

  /** Dismisses the row menu. Every action closes it first, so nothing runs under a panel still on screen. */
  const closeTreeMenu = (): void => {
    treeMenu.close();
    setTreeMenuTarget(null);
  };

  /**
   * The tree's context menu, hung on the whole pane. A gesture that lands between rows — the
   * search box, the empty space below the last row — resolves no target, so nothing is
   * suppressed and the browser's own menu stands, which is what the search box needs to be
   * pasteable into.
   */
  const treeMenuProps = {
    onContextMenu: (e: ReactMouseEvent) => {
      const row = hitRow(e.target);
      if (row === null) return;
      // Before the hook reads it: the anchor for a keyboard-synthesized contextmenu is the
      // row's own box, and the hook measures whatever `rowRef` currently points at.
      treeMenu.rowRef(row.el);
      setTreeMenuTarget({ path: row.path, kind: row.kind });
      treeMenu.rowProps.onContextMenu(e);
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (!isContextMenuKey(e)) return;
      // The roving tab stop is what has focus, so the event's own target is the row the
      // keyboard means — no separate lookup of "the focused row" is needed.
      const row = hitRow(e.target);
      if (row === null) return;
      e.preventDefault();
      treeMenu.rowRef(row.el);
      setTreeMenuTarget({ path: row.path, kind: row.kind });
      const r = row.el.getBoundingClientRect();
      treeMenu.openAt({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    },
    onPointerDown: (e: ReactPointerEvent) => {
      // Only a press-and-hold opens from here; a mouse arrives through onContextMenu instead,
      // and running this for every click would re-render the panel on each one.
      if (!isLongPressPointer(e.pointerType)) return;
      const row = hitRow(e.target);
      if (row === null) return;
      treeMenu.rowRef(row.el);
      setTreeMenuTarget({ path: row.path, kind: row.kind });
      treeMenu.rowProps.onPointerDown(e);
    },
    onPointerMove: treeMenu.rowProps.onPointerMove,
    onPointerUp: treeMenu.rowProps.onPointerUp,
    onPointerCancel: treeMenu.rowProps.onPointerCancel,
    // A touch screen replays the held press as a click once the finger lifts, and a tree row's
    // click opens the file or the folder. Swallowed in the capture phase so the row never hears
    // it — the rows themselves know nothing about this menu.
    onClickCapture: (e: ReactMouseEvent) => {
      if (!treeMenu.consumeLongPressClick()) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  /**
   * The rendered source lines a preview selection can be measured against — the source view's
   * own, and deliberately none in the rendered Markdown and HTML views. A Markdown body draws
   * code blocks of its own, whose line spans would answer with a line number belonging to some
   * other file; no range at all is the honest reading there.
   */
  const sourceLines = (host: HTMLElement | null): HTMLElement[] => {
    const p = previewRef.current;
    const source = p !== null && (p.kind === "text" || richViewRef.current === "source");
    return source && host !== null ? [...host.querySelectorAll<HTMLElement>(".line")] : [];
  };

  /**
   * The preview's context menu. Its target is always the file on screen, so the only thing to
   * resolve is whether a selection sits inside the preview — read here, at the gesture, rather
   * than when a row is clicked: focusing the menu can collapse the live selection under it.
   */
  const openPreviewMenu = (e: ReactMouseEvent): void => {
    const host = previewBodyRef.current;
    setMenuSelection(readSelection(host, sourceLines(host)));
    previewMenu.rowProps.onContextMenu(e);
  };

  /** Same as the row menu's: the preview's own links must not fire on the click a hold replays. */
  const previewMenuClickCapture = (e: ReactMouseEvent): void => {
    if (!previewMenu.consumeLongPressClick()) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const addSelectionToChat = (p: Preview, selection: PreviewSelection): void => {
    onInsertReference(
      selectionBlock({
        path: p.path,
        language: languageForExtension(extOf(p.name)),
        selection: selection.text,
        fromLine: selection.fromLine,
        toLine: selection.toLine,
      }),
      "block",
    );
    // The text stays selected: contributing a quote to the conversation is not an edit to the
    // preview, and losing the highlight would cost the reader their place in the file.
    restoreSelection(selection.range);
  };

  // -------------------------------------------------------------------------------- drop
  // The panel is its own drop region, decided by the same stateless rule as the chat
  // area's (dropRegionAction): every event re-derives whether a file drag is over the panel,
  // so no missed event can strand the overlay. Claiming the drag here (preventDefault on
  // dragover) is what makes the app-shell guard stand aside and the browser deliver the
  // drop; the chat area's zone tests events against its own region and ignores these.
  const applyDrag = (
    signal: DragSignal,
    e: ReactDragEvent<HTMLDivElement>,
    inside: boolean,
  ): { accept: boolean; targetDir: string } => {
    const action = dropRegionAction(signal, isFileDrag(e.dataTransfer.types), inside);
    const targetDir =
      action.active || action.accept ? dropTargetDir(hitRow(e.target), currentDirRef.current) : "";
    if (action.claim) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
    const shown = action.active ? targetDir : "";
    // dragover fires tens of times a second; only a real change is routed through state.
    setDrag((d) =>
      d.active === action.active && d.targetDir === shown
        ? d
        : { active: action.active, targetDir: shown },
    );
    return { accept: action.accept, targetDir };
  };
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    applyDrag("over", e, true);
  };
  // `relatedTarget` is where the drag is going: still inside the panel means an internal
  // element boundary was crossed and nothing changed.
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    applyDrag(
      "leave",
      e,
      root !== null && e.relatedTarget instanceof Node && root.contains(e.relatedTarget),
    );
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    const { accept, targetDir } = applyDrag("drop", e, true);
    if (!accept) return;
    const { files, dirs } = pickDroppedFiles(e.dataTransfer);
    if (dirs.length > 0) toastError(S.files.folderDropSkipped(dirs.join(", ")));
    if (files.length > 0) void stageUpload(files, targetDir);
  };

  // ------------------------------------------------------------------------------ render

  const filter = query.trim();
  const rows = useMemo(() => {
    if (filter === "") return flattenTree(listings, expanded);
    // A filter walks every LISTED directory, whatever the user left open: the search
    // reaches exactly as far as the lazy tree has loaded, and a match is only reachable
    // with its ancestors open above it.
    return filterTreeRows(flattenTree(listings, new Set(listings.keys())), filter);
  }, [listings, expanded, filter]);
  const rootListing = listings.get("");
  const crumbSegments =
    currentDir === "" ? [S.files.root] : [S.files.root, ...currentDir.split("/")];
  const crumbPath = currentDir === "" ? S.files.root : `${S.files.root}/${currentDir}`;
  // An unmeasured strip (before the first ResizeObserver callback) shows the whole path:
  // the actions cannot be pushed off the row either way — they are shrink-0 and the strip
  // clips — and a "…" for one frame on a path that fits reads as a flicker.
  const crumbFit = visibleCrumbSegments(
    crumbSegments,
    crumbsWidth > 0 ? crumbsWidth : Number.POSITIVE_INFINITY,
    crumbItemWidth,
  );
  const showTree = narrow ? selectedPath === null : treeVisible;
  const showPreview = narrow ? selectedPath !== null : true;
  const canEdit = preview !== null && editor === null && canEditPreview(preview);
  /** The source view is on screen: a text file, or Markdown/HTML with the toggle on Source. */
  const sourceShown =
    preview !== null &&
    (preview.kind === "text" ||
      ((preview.kind === "md" || preview.kind === "html") && richView === "source"));
  /** The file's text is on screen to read or to edit. Both present it the same way, so both take the Wrap toggle. */
  const textShown =
    sourceShown || (preview !== null && editor !== null && editor.path === preview.path);
  /** The upload picker's one name — its accessible name and its tooltip both — carrying the running count while an upload is in flight. */
  const uploadLabel =
    uploading !== null ? S.files.uploading(uploading.done, uploading.total) : S.files.upload;
  /** Likewise for the preview's external link, which folds the sandboxing caveat into its name when there is one. */
  const openInNewTabLabel = previewIsolated
    ? S.files.openInNewTab
    : `${S.files.openInNewTab}: ${S.files.previewNotIsolatedHint}`;
  const dirLabel = (dir: string): string => (dir === "" ? S.files.root : dir);

  const tree = (
    <div
      ref={treePaneRef}
      {...treeMenuProps}
      className={`flex min-h-0 flex-col ${narrow ? "flex-1" : "shrink-0 border-r border-gray-200 dark:border-gray-800"}`}
      style={narrow ? undefined : { width: treeWidth }}
    >
      {/* Search: filters the rows already loaded. Esc clears it rather than reaching the
          dock or a dialog above, which is what an Esc in a non-empty box means here. */}
      <div className="relative shrink-0 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || query === "") return;
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }}
          placeholder={S.files.searchPlaceholder}
          aria-label={S.files.searchPlaceholder}
          {...noAutofill}
          className="w-full rounded border border-gray-200 bg-transparent py-1 pl-2 pr-7 text-xs text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-gray-500"
        />
        {query !== "" && (
          <button
            type="button"
            aria-label={S.files.searchClear}
            title={S.files.searchClear}
            onClick={() => setQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      {rootError !== null ? (
        <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{rootError}</p>
      ) : rootListing === undefined ? (
        <SkeletonList rows={6} />
      ) : (
        <WorkspaceTreeView
          rows={rows}
          selectedPath={selectedPath}
          currentDir={currentDir}
          loadingDirs={loadingDirs}
          dropTargetDir={drag.active ? drag.targetDir : null}
          scrollTo={scrollTo}
          rootEmpty={rootListing.length === 0}
          filtering={filter !== ""}
          toggled={filter === "" ? toggled : null}
          onToggleDir={filter === "" ? toggleDir : openDirForFilter}
          onOpenFile={openFile}
        />
      )}
      {/* The row menu. `contents` keeps this wrapper out of the pane's column: it draws no box
          of its own, the panel is portaled, and the anchor is the point the gesture landed on
          rather than this element (the same shape the sidebar's session row uses). */}
      {treeMenuTarget !== null && (
        <Dropdown
          open={treeMenu.open}
          // The target is not cleared here: a dismiss is not always believed (a touch screen
          // replays the held press as an outside click on the menu that gesture just opened),
          // and unmounting the panel on a dismiss the hook refused would close it anyway. It
          // is cleared where the menu really closes — an action, or the Session switching.
          setOpen={treeMenu.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={treeMenu.anchor}
          anchorOwner={treeMenu.anchorOwner}
          // A tree row carries no button of its own, so the Dropdown's default return target
          // finds nothing: hand Escape back to the row itself.
          returnFocus={treeMenu.anchorOwner}
          className="contents"
          menuClass="w-48"
          button={null}
        >
          <WorkspaceFileMenuRows
            target={treeMenuTarget}
            downloadHref={(path) => api.workspaceFileUrl(sessionId, path, true)}
            downloadName={baseName}
            onCopyPath={(t) => {
              closeTreeMenu();
              copyPath(t);
            }}
            onAddToChat={(t) => {
              closeTreeMenu();
              addToChat(t);
            }}
            onUploadInto={(dir) => {
              closeTreeMenu();
              uploadInto(dir);
            }}
            onClose={closeTreeMenu}
          />
        </Dropdown>
      )}
    </div>
  );

  // The divider: a real layout sibling, so the two panes always add up to the panel.
  const treeDivider = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={S.files.treeWidth}
      aria-valuenow={treeWidth}
      aria-valuemin={TREE_MIN_WIDTH}
      // Before the first measurement there is no ceiling yet (clampTreeWidth applies none),
      // so the current width is the honest maximum for that frame.
      aria-valuemax={Math.max(maxTreeWidth(width), treeWidth)}
      title={S.files.treeWidth}
      tabIndex={0}
      {...treeResizeProps}
      onKeyDown={onDividerKey}
      className={`w-1.5 shrink-0 cursor-col-resize outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/60 ${
        resizingTree
          ? "bg-gray-300 dark:bg-gray-600"
          : "bg-transparent hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
    />
  );

  /**
   * Soft wrap. One toggle and one remembered answer for the source view and the editor alike —
   * they are the same file seen two ways, and a second preference would let Edit reflow the
   * file under the line the user was aiming at.
   */
  const wrapToggle = textShown && (
    <Tooltip label={S.files.wrapLines} placement="bottom" className="shrink-0">
      <button
        type="button"
        aria-pressed={wrapLines}
        aria-label={S.files.wrapLines}
        onClick={() => setWrap(!wrapLines)}
        className={iconToggleClass(wrapLines)}
      >
        <GlyphIcon d={WRAP_TEXT_ICON} size={ICON_SIZE.iconButton} />
      </button>
    </Tooltip>
  );

  const richToggle = preview !== null && (preview.kind === "html" || preview.kind === "md") && (
    <div className="flex shrink-0 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
      {(
        [
          ["rendered", S.files.htmlRendered],
          ["source", S.files.htmlSource],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={richView === key}
          onClick={() => setRichView(key)}
          className={`rounded px-2 py-0.5 text-xs transition-colors duration-150 ${
            richView === key
              ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const previewBody = (p: Preview) => {
    if (editor !== null && editor.path === p.path) {
      return (
        <div className="min-h-0 flex-1">
          <WorkspaceFileEditor
            path={editor.path}
            value={editor.draft}
            wrap={wrapLines}
            onChange={updateDraft}
            onSave={requestSave}
          />
        </div>
      );
    }
    const selection = menuSelection;
    return (
      <>
        {/* scrollbar-gutter: an SVG carries no pixel size, so its height is whatever its width
          divides to — which makes the content height a function of the scrollbar's presence.
          Without a reserved gutter that closes a loop: content overflows -> scrollbar takes
          width -> the image shrinks -> content fits -> scrollbar goes -> repeat, forever, as
          a visible shake. Reserving it always breaks the feedback path (and is inert where
          scrollbars are overlays). */}
        <div
          ref={(el) => {
            previewBodyRef.current = el;
            // The same element is the menu's keyboard anchor and its scroll owner: a scroll of
            // this box moves the point the panel hangs off.
            previewMenu.rowRef(el);
          }}
          onContextMenu={openPreviewMenu}
          onKeyDown={previewMenu.rowProps.onKeyDown}
          onPointerDown={(e) => {
            // Only the press-and-hold path can open the menu from here, and only it is worth
            // walking the rendered lines for: an ordinary click would pay that on every click.
            if (isLongPressPointer(e.pointerType)) {
              setMenuSelection(
                readSelection(previewBodyRef.current, sourceLines(previewBodyRef.current)),
              );
            }
            previewMenu.rowProps.onPointerDown(e);
          }}
          onPointerMove={previewMenu.rowProps.onPointerMove}
          onPointerUp={previewMenu.rowProps.onPointerUp}
          onPointerCancel={previewMenu.rowProps.onPointerCancel}
          onClickCapture={previewMenuClickCapture}
          // Focusable only programmatically, and only so Escape has somewhere to hand focus
          // back to: the menu is anchored at this box, and a div with no tabindex would take
          // none, leaving focus on the body when the panel it was in unmounts. -1 keeps it out
          // of the tab order, and the outline is suppressed because the focus is a handover,
          // not a destination the user chose.
          tabIndex={-1}
          // The source view brings its own padding, and has to: the editor's textarea lies on
          // top of it, and only padding the two layers share keeps the typed text over the
          // highlighted text.
          className={`min-h-0 flex-1 overflow-auto outline-none [scrollbar-gutter:stable] ${
            sourceShown && preview?.content !== undefined ? "" : "p-3"
          }`}
        >
          {p.kind === "image" ? (
            // Keyed on the nonce like the isolated HTML iframe: the src alone is unchanged
            // when the same file is re-read, so only a remount re-requests the bytes the
            // Agent just rewrote.
            <ZoomableImage
              key={p.nonce}
              src={api.workspaceFileUrl(sessionId, p.path)}
              alt={p.name}
              className="max-w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : p.kind === "pdf" ? (
            <iframe
              key={p.nonce}
              src={api.workspaceFileUrl(sessionId, p.path)}
              title={p.name}
              className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : p.kind === "html" && richView === "rendered" ? (
            previewIsolated ? (
              // Same URL and serving path as "open in new tab": the app-origin redirect mints
              // a token and 302s to the separate preview origin, where the document has a real
              // base URL — relative subresources (<img src="foo.png">, app.js, style.css)
              // resolve and load, and storage works, exactly as in the new-page preview.
              // allow-same-origin is safe here precisely because the document IS on a separate
              // origin: it grants the preview origin's identity, not the app's, so the frame
              // still can't reach the app's cookies or DOM. Popups stay sandboxed (no
              // allow-popups-to-escape-sandbox); allow-downloads keeps download links inside
              // the page working, as they do in the new tab. The key remounts the iframe on
              // every previewPath call — its src alone wouldn't change when the same file is
              // re-opened after the Agent rewrote it.
              <iframe
                key={p.nonce}
                src={api.workspaceFilePreviewUrl(sessionId, p.path)}
                title={p.name}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
              />
            ) : p.content === undefined ? (
              // Only reachable when previewIsolated flipped to false after an isolated
              // preview mounted without content: the lazy source effect is already fetching
              // it, and the srcDoc fallback renders once it lands.
              sourceError !== null ? (
                <p className="text-sm text-red-600 dark:text-red-400">{sourceError}</p>
              ) : (
                <SkeletonList rows={6} />
              )
            ) : (
              // No separate preview origin: srcDoc fallback. sandbox allows scripts but
              // **without allow-same-origin**: the iframe has an opaque origin, so scripts can
              // run to fully render the page, yet can't read the app's same-origin cookies /
              // DOM (an XSS defense). The storage shim is injected to avoid a SecurityError
              // when a script accesses localStorage from an opaque origin. srcdoc has no real
              // base URL, so relative subresources cannot resolve here — that's what the
              // isolated branch above fixes.
              <iframe
                srcDoc={withStorageShim(p.content)}
                title={p.name}
                sandbox="allow-scripts"
                className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
              />
            )
          ) : p.kind === "md" && richView === "rendered" ? (
            // Markdown's default rendered view: uses the same md-body layout as message bodies
            // (ReactMarkdown outputs pure static HTML with no script execution surface, so no iframe sandbox is needed).
            <>
              <div className="md-body text-base leading-relaxed text-gray-800 dark:text-gray-100">
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  rehypePlugins={REHYPE_PLUGINS}
                  components={{
                    // Relative images are resolved against the md file's directory into the file API (otherwise resolving against the app's origin would always 404).
                    // `v` is the read nonce, not a cache-buster for its own sake: a
                    // Workspace image is rewritten under the same path, and without it a
                    // re-read of the Markdown would keep painting the previous bytes from
                    // the browser's image cache.
                    img: ({ src, alt }) => (
                      <img
                        src={
                          typeof src === "string" && !EXTERNAL_REF_RE.test(src)
                            ? `${api.workspaceFileUrl(
                                sessionId,
                                resolveRelative(parentDir(p.path), src),
                              )}&v=${p.nonce}`
                            : src
                        }
                        alt={alt ?? ""}
                        loading="lazy"
                        className="max-w-full"
                      />
                    ),
                    // External links open in a new tab; relative links point to a Workspace
                    // file, clicking opens it in the tree and the preview; in-page anchors keep default behavior.
                    a: ({ href, children }) => {
                      if (typeof href !== "string" || href.startsWith("#")) {
                        return <a href={href}>{children}</a>;
                      }
                      if (EXTERNAL_REF_RE.test(href)) {
                        return (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        );
                      }
                      const target = resolveRelative(parentDir(p.path), href);
                      return (
                        <a
                          href={api.workspaceFileUrl(sessionId, target)}
                          onClick={(e) => {
                            e.preventDefault();
                            openFile(target, { locate: true });
                          }}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {p.content ?? ""}
                </ReactMarkdown>
              </div>
              {p.truncated && (
                <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
              )}
            </>
          ) : p.kind === "text" || p.kind === "html" || p.kind === "md" ? (
            p.content === undefined ? (
              // Isolated HTML reaches the Source view before its lazy fetch lands: show a
              // skeleton (or the fetch's own error) — toggling back to Rendered is
              // unaffected, and re-entering Source retries the fetch.
              sourceError !== null ? (
                <p className="text-sm text-red-600 dark:text-red-400">{sourceError}</p>
              ) : (
                <SkeletonList rows={6} />
              )
            ) : (
              // The text itself, with no box around it — the same surface the editor lays its
              // textarea over, so Edit changes what you can do and nothing about what you see.
              // Wrapping is the Wrap toggle's business here; the message stream's own code
              // blocks still scroll sideways rather than wrap, which is a transcript's answer
              // and not a file viewer's.
              <>
                <CodeSurface
                  language={languageForExtension(extOf(p.name))}
                  code={p.content}
                  highlight={p.content.length <= HIGHLIGHT_LIMIT}
                  lineNumbers
                  wrap={wrapLines}
                  className="text-xs leading-relaxed"
                />
                {p.truncated && (
                  <p className="px-3 pb-2 text-xs text-gray-400">… {S.files.previewTruncated}</p>
                )}
              </>
            )
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.files.previewUnsupported}</p>
          )}
        </div>
        {/* The same menu the file's own tree row offers, plus the selection entry while there is
          one. A right-click inside the HTML or PDF preview never arrives here — those are
          iframes, and nothing on this side of them can hear it — so the menu is what the
          surrounding preview chrome offers. */}
        <Dropdown
          open={previewMenu.open}
          setOpen={previewMenu.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={previewMenu.anchor}
          anchorOwner={previewMenu.anchorOwner}
          returnFocus={previewMenu.anchorOwner}
          className="contents"
          menuClass="w-48"
          button={null}
        >
          <WorkspaceFileMenuRows
            target={{ path: p.path, kind: "file" }}
            downloadHref={(path) => api.workspaceFileUrl(sessionId, path, true)}
            downloadName={baseName}
            onCopyPath={(t) => {
              previewMenu.close();
              copyPath(t);
            }}
            onAddToChat={(t) => {
              previewMenu.close();
              addToChat(t);
            }}
            // Never reached: a preview is always a file, so the upload row is never drawn here.
            onUploadInto={uploadInto}
            onAddSelection={
              selection === null
                ? undefined
                : () => {
                    previewMenu.close();
                    addSelectionToChat(p, selection);
                  }
            }
            onClose={previewMenu.close}
          />
        </Dropdown>
      </>
    );
  };

  const previewPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {selectedPath === null ? (
        <EmptyState
          title={S.files.selectFile}
          action={
            !treeVisible && !narrow ? (
              <Button size="sm" onClick={() => setTree(true)}>
                {S.files.showTree}
              </Button>
            ) : undefined
          }
        />
      ) : preview === null || preview.path !== selectedPath ? (
        <SkeletonList rows={6} />
      ) : (
        <>
          {/* flex-wrap: the preview can be as narrow as the dock allows, narrower than this
              row's uncompressible content (view toggle + actions); without wrapping, the
              panel's overflow-hidden would clip the right-side buttons off. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
            {narrow && (
              <button
                type="button"
                onClick={backToTree}
                title={S.files.backToList}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <GlyphIcon d={BACK_ICON} size={ICON_SIZE.rowLead} />
                {S.files.backToList}
              </button>
            )}
            {/* Shows only the filename (full path goes into the title hover tooltip): the
                directory prefix is what the breadcrumbs above already say, and on a narrow
                panel it would just crowd out the title space. */}
            <span
              className="min-w-0 flex-1 truncate font-mono text-sm font-semibold"
              title={preview.path}
            >
              {preview.name}
            </span>
            {editor !== null && editor.path === preview.path ? (
              <>
                {editor.changedOnDisk === true && (
                  <span
                    className={`shrink-0 text-xs ${toneInk.attention}`}
                    title={S.files.changedOnDiskHint}
                  >
                    {S.files.changedOnDisk}
                  </span>
                )}
                {dirty && (
                  <span className={`shrink-0 text-xs ${toneInk.attention}`}>{S.files.unsaved}</span>
                )}
                {wrapToggle}
                <Button size="sm" onClick={cancelEdit} disabled={saving}>
                  {S.common.cancel}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={requestSave}
                  disabled={saving}
                  title={S.files.saveTitle}
                >
                  {saving ? S.common.saving : S.common.save}
                </Button>
              </>
            ) : (
              <>
                {richToggle}
                {wrapToggle}
                {canEdit && (
                  <Tooltip label={S.common.edit} placement="bottom" className="shrink-0">
                    <button
                      type="button"
                      aria-label={S.common.edit}
                      onClick={() => void startEdit()}
                      className={iconActionClass}
                    >
                      <GlyphIcon d={FILE_EDIT_ICON} size={ICON_SIZE.iconButton} />
                    </button>
                  </Tooltip>
                )}
                {/* rel="noopener noreferrer" is load-bearing, not boilerplate: the preview must
                    not keep a handle back to this window, which is the whole point of serving
                    it from a separate origin.

                    Without a separate preview origin the page opens sandboxed, and the caveat
                    joins the name rather than riding a ⚠ beside it: the name is all an
                    icon-only control has, and the tooltip shows the same words so the two
                    cannot disagree. The tint is a second carrier, never the only one. */}
                {/\.html?$/i.test(preview.name) && (
                  <Tooltip label={openInNewTabLabel} placement="bottom" className="shrink-0">
                    <a
                      href={api.workspaceFilePreviewUrl(sessionId, preview.path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={openInNewTabLabel}
                      className={`${iconActionClass} ${previewIsolated ? "" : toneInk.attention}`}
                    >
                      <GlyphIcon d={EXTERNAL_LINK_ICON} size={ICON_SIZE.iconButton} />
                    </a>
                  </Tooltip>
                )}
                {/* Copy lived in the code block's own header bar; the source view no longer has
                    one, so it joins the file's other take-it-away actions here. It copies the
                    text that was read, which is all of the file unless the preview was cut off. */}
                {sourceShown && preview.content !== undefined && (
                  <>
                    <Tooltip
                      label={copied ? S.common.copied : S.chat.copyCode}
                      placement="bottom"
                      className="shrink-0"
                    >
                      <button
                        type="button"
                        aria-label={S.chat.copyCode}
                        onClick={() => flashCopy(preview.content ?? "")}
                        className={iconActionClass}
                      >
                        <CopyCheckGlyph copied={copied} size={ICON_SIZE.iconButton} />
                      </button>
                    </Tooltip>
                    {/* Sibling, not a child: the button's accessible name stays the label, and
                        the glyph swap is silent without this region. */}
                    <CopiedStatus copied={copied} />
                  </>
                )}
                <Tooltip label={S.files.download} placement="bottom" className="shrink-0">
                  <a
                    href={api.workspaceFileUrl(sessionId, preview.path, true)}
                    download={preview.name}
                    aria-label={S.files.download}
                    className={iconActionClass}
                  >
                    <GlyphIcon d={DOWNLOAD_ICON} size={ICON_SIZE.iconButton} />
                  </a>
                </Tooltip>
              </>
            )}
          </div>
          {previewBody(preview)}
        </>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Toolbar: tree toggle + the current directory's path + actions. One row that never
          wraps — the path strip absorbs the pressure (it clips, and its leading segments
          collapse), the actions keep their width. */}
      <div className="flex shrink-0 flex-nowrap items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
        {!narrow && (
          // Static accessible name, state on aria-pressed alone: a name that swaps Show/Hide
          // beside it reads as "Hide file tree, pressed", saying the state twice and
          // disagreeing with itself. The tooltip may still swap — it is presentation only.
          <button
            type="button"
            aria-pressed={treeVisible}
            title={treeVisible ? S.files.hideTree : S.files.showTree}
            aria-label={S.files.showTree}
            onClick={() => setTree(!treeVisible)}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors duration-150 ${
              treeVisible
                ? "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <GlyphIcon d={PANEL_LEFT_ICON} size={ICON_SIZE.iconButton} />
          </button>
        )}
        {/* The path, read out and not navigable: the tree beside it is what navigates, and a
            second way in would only be a second thing to keep in step with the editor's
            unsaved-changes guard. */}
        <div
          ref={crumbsRef}
          title={crumbPath}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-1 text-sm"
        >
          {crumbFit.collapsed && (
            <span className="shrink-0 text-gray-400 dark:text-gray-500">{CRUMB_ELLIPSIS}</span>
          )}
          {crumbFit.visible.map((seg, i) => (
            <Fragment key={`${i}-${seg}`}>
              {(crumbFit.collapsed || i > 0) && (
                <span className="shrink-0 text-gray-300 dark:text-gray-700">/</span>
              )}
              <span
                className={
                  i === crumbFit.visible.length - 1
                    ? "min-w-0 truncate font-medium text-gray-700 dark:text-gray-200"
                    : "shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400"
                }
              >
                {seg}
              </span>
            </Fragment>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip label={S.files.refresh} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.files.refresh}
              onClick={refreshAll}
              className={iconActionClass}
            >
              <GlyphIcon d={REFRESH_ICON} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
          {/* The picker's own input carries the name: a label with no text names nothing, and
              the glyph inside it is aria-hidden. While an upload runs the count is all the
              tooltip has left to say it with, so it goes there and the glyph becomes a
              spinner. */}
          <Tooltip label={uploadLabel} placement="bottom" className="shrink-0">
            <label
              className={`${iconActionClass} cursor-pointer focus-within:ring-2 focus-within:ring-gray-400/30`}
            >
              <HiddenFileInput
                multiple
                onChange={onPick}
                disabled={uploading !== null}
                aria-label={uploadLabel}
              />
              {uploading !== null ? (
                <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <GlyphIcon d={UPLOAD_ICON} size={ICON_SIZE.iconButton} />
              )}
            </label>
          </Tooltip>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Narrow: one column, tree or preview. */}
        {narrow && showTree && tree}
        {/* Wide: the tree and its divider stay mounted and slide in and out of the panel's
            left edge, on the same 200ms width transition the dock itself expands and
            collapses with. Both keep their own width inside the clipping window, so the tree
            does not reflow as it moves; the preview beside it takes the room it leaves.
            inert while away — a pane at zero width is not somewhere to tab into. */}
        {!narrow && (
          <div
            aria-hidden={!treeVisible}
            inert={!treeVisible}
            style={{ width: treeVisible ? treeWidth + TREE_DIVIDER_PX : 0 }}
            className={`flex min-h-0 shrink-0 overflow-hidden ${
              treeSliding ? "transition-[width] duration-200" : ""
            }`}
          >
            {tree}
            {treeDivider}
          </div>
        )}
        {showPreview && previewPane}
        {/* Drop feedback: a dashed frame over the panel and a label naming the directory the
            files will land in. Pure feedback — pointer-events-none keeps the hit test on the
            rows underneath, which is how a folder row can be the target. */}
        {drag.active && (
          <div
            aria-hidden
            className="anim-fade pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-3"
          >
            <div className="absolute inset-1 rounded-lg border-2 border-dashed border-gray-400 bg-white/40 dark:border-gray-500 dark:bg-gray-950/40" />
            <div className="relative flex items-center gap-2 rounded-md border border-gray-300 bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-100">
              <GlyphIcon d={PAPERCLIP_ICON} size={ICON_SIZE.rowLead} className="text-gray-400" />
              <span className="truncate">{S.files.dropToUpload(dirLabel(drag.targetDir))}</span>
            </div>
          </div>
        )}
      </div>

      {/* The menu's picker. Not the app's HiddenFileInput: that one stays Tab-focusable because
          a <label> wraps and names it, and this one has no label — it is opened by a menu row
          and must not sit in the tab order as an unnamed control. */}
      <input
        ref={menuUploadRef}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden
        className="hidden"
        onChange={onMenuPick}
      />

      {/* Upload-overwrite confirmation: same-name files in the target directory get replaced. */}
      <ConfirmModal
        open={pendingUpload !== null}
        title={S.files.overwriteTitle}
        tone="primary"
        confirmLabel={S.files.upload}
        onClose={() => setPendingUpload(null)}
        onConfirm={() => {
          if (pendingUpload) void doUpload(pendingUpload.files, pendingUpload.dir);
          setPendingUpload(null);
        }}
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.files.overwriteConfirm(pendingUpload?.clashes.length ?? 0)}
          </p>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-gray-200 px-3 py-1.5 dark:border-gray-800">
            {(pendingUpload?.clashes ?? []).map((name) => (
              <li key={name} className="truncate py-0.5 font-mono text-xs" title={name}>
                {name}
              </li>
            ))}
          </ul>
        </div>
      </ConfirmModal>

      {/* Save confirmation: the file in the Workspace is overwritten, like every server-side write. */}
      <ConfirmModal
        open={saveConfirm}
        title={S.files.saveConfirmTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={saving}
        onClose={() => setSaveConfirm(false)}
        onConfirm={() => void save()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.files.saveConfirm(editor !== null ? baseName(editor.path) : "")}
        </p>
      </ConfirmModal>

      {/* Write-precondition conflict: the file changed after the editor opened it, so the
          save was refused with nothing written. Cancel keeps the draft and the editor. */}
      <ConfirmModal
        open={conflict !== null}
        title={S.files.conflictTitle}
        tone="primary"
        confirmLabel={S.files.overwriteAnyway}
        onClose={() => setConflict(null)}
        onConfirm={() => void save({ overwrite: true })}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.files.conflictBody(conflict?.name ?? "")}
        </p>
      </ConfirmModal>

      {/* Unsaved-changes guard: leaving the edited file, closing the panel, cancelling. */}
      <ConfirmModal
        open={discardPrompt !== null}
        title={S.files.discardTitle}
        confirmLabel={S.files.discard}
        onClose={() => {
          discardPrompt?.resolve(false);
          setDiscardPrompt(null);
        }}
        onConfirm={() => {
          discardPrompt?.resolve(true);
          setDiscardPrompt(null);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.files.discardBody(editor !== null ? baseName(editor.path) : "")}
        </p>
      </ConfirmModal>
    </div>
  );
}
