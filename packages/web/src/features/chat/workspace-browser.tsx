/**
 * Workspace file browser (the Files panel): a directory tree on the left, listing each
 * directory the first time it opens, and a preview of the selected file on the right —
 * Markdown / HTML rendered with a source toggle, text inline (highlighted), images inline
 * (click to zoom), PDF embedded, everything else offered as a download. Text files can be
 * edited in place: Edit swaps the preview for a plain textarea, Save writes the file back
 * through the content endpoint, and unsaved changes are guarded wherever they could be
 * lost. The editor keeps its place as a code editor does — it opens where the preview was
 * scrolled, a save leaves it open with caret and scroll untouched, and when a finished turn
 * rewrote the file under an editor holding nothing unsaved, it takes the new text in place.
 * OS files dropped anywhere on the panel upload into the current directory — onto a folder
 * row, into that folder. New text files and folders are made from the tree header's New
 * menu, a folder's menu or the blank space under the tree; folders rename and move whole.
 *
 * The panel is addressed by its scope (api/workspace-files.ts): a Session's Workspace on the
 * chat page, or a directory named by its path on the new-chat draft, where no Session exists
 * yet. Everything below follows the scope; a new scope starts the panel over.
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
 *
 * This file is the container: it lists, fetches, edits, uploads and guards. What the panel looks
 * like is the UI package's — the tree pane (`TreePane` over `FileTree`), the preview pane
 * (`PreviewPane`, with `WorkspaceFileEditor` in it while a file is edited), the draggable split
 * between them (`SplitPane`), the path strip (`Breadcrumbs`), the drop feedback (`DropOverlay`)
 * and the file menu's rows (`WorkspaceFileMenuRows`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  Breadcrumbs,
  Button,
  CloseIcon,
  ConfirmModal,
  CopiedStatus,
  CopyCheckGlyph,
  DropOverlay,
  Dropdown,
  GlyphIcon,
  HiddenFileInput,
  ICONS,
  ICON_SIZE,
  Input,
  PreviewPane,
  SplitPane,
  Spinner,
  Tooltip,
  TreePane,
  WorkspaceFileEditor,
  WorkspaceFileMenuRows,
  WorkspaceNewMenuRows,
  isContextMenuKey,
  isLongPressPointer,
  languageForFileName,
  noAutofill,
  toastError,
  toastInfo,
  toastSuccess,
  useCopied,
  useRowContextMenu,
} from "@prismshadow/penguin-ui";
import type {
  EditorScroll,
  FileMenuTarget,
  PreviewView,
  TreeToggle,
  WorkspaceFileMenuLabels,
} from "@prismshadow/penguin-ui";
import type { WorkspaceSearchHit } from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import { filesApi, filesScopeKey } from "../../api/workspace-files";
import type { FilesScope } from "../../api/workspace-files";
import { useAuth } from "../../state/auth";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { isDesktopShellWindow } from "../../lib/account-menu";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { isShortcut } from "../../lib/shortcuts/match";
import { currentPlatform } from "../../lib/shortcuts/platform";
import { keymap } from "../../lib/shortcuts/store";
import { joinWorkspacePath } from "../../lib/file-path";
import { writeClipboard } from "../../lib/clipboard";
import { dropRegionAction, isFileDrag } from "../../lib/file-drop";
import type { DragSignal } from "../../lib/file-drop";
import { MB_BYTES, splitBySize } from "../../lib/upload-limits";
import {
  DEFAULT_TEXT_FILE_NAME,
  TEXT_PREVIEW_LIMIT,
  TREE_MIN_WIDTH,
  WORKSPACE_UPLOAD_LIMIT_MB,
  ancestorDirs,
  baseName,
  canEditPreview,
  clampTreeWidth,
  defaultTreeWidth,
  dropTargetDir,
  expandTo,
  searchRows,
  flattenTree,
  isDirty,
  isNarrowLayout,
  isWithin,
  looksLikeText,
  maxTreeWidth,
  movedListings,
  movedPath,
  movedSet,
  needsDiscardConfirm,
  newEntryName,
  parentDir,
  pathReference,
  previewKindFor,
  readWrapLines,
  readTreeVisible,
  readTreeWidth,
  selectionBlock,
  stemEnd,
  upsertEntry,
  utf8Complete,
  withExpanded,
  writeWrapLines,
  writeTreeVisible,
  writeTreeWidth,
} from "../../lib/workspace-tree";
import type { ComposerReference, EditorState, Listings } from "../../lib/workspace-tree";
import { restoreSelection } from "../../components/ui/text-selection";
import { STAT_ICONS } from "../../lib/stat-icons";
import { toneInk } from "../../lib/tone";
import { setCloseGuard } from "../dock/close-guard";
import { tabKey } from "../dock/dock-state";
import { PAPERCLIP_ICON } from "./attached-files-banner";
import { WorkspaceTreeView } from "./workspace-tree-view";

/**
 * Above this, a Markdown file opens in the source view rather than rendered. Highlighting moved to
 * a worker and no longer needs a ceiling, but rendering Markdown is remark parsing plus a React
 * tree, both on the main thread — so this one is still a real cost and still has to be bounded.
 * The reader can switch to the rendered view themselves, which makes it their informed choice.
 */
const MD_RENDER_LIMIT = 64 * 1024;

/** Bytes examined to decide whether a file with an unknown extension is text. */
const SNIFF_BYTES = 8 * 1024;
/** How long the search box settles before the query is sent. A Workspace walk is not free, and nobody reads results for a prefix they are still typing. */
const SEARCH_DEBOUNCE_MS = 250;

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
 * Unsaved editor drafts by scope (a Session, or a directory — see filesScopeKey) and path,
 * kept for the app's lifetime and written through on every keystroke. Hiding the panel or its
 * dock keeps this component mounted, draft and all; what the map is for are the paths no
 * confirm dialog can intercept, where the body really is unmounted — a tab dragged to the
 * other edge, a Session switched from the sidebar. The draft outlives the component: opening
 * the same file again reopens the editor on it.
 */
const unsavedDrafts = new Map<string, string>();
const draftKey = (scopeKey: string, path: string): string => `${scopeKey}\n${path}`;

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

/**
 * The tree's blank space under the rows, or null: a gesture inside the tree that lands on no
 * row. The search box sits above the tree, outside it, and so never counts.
 */
function hitBlank(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || hitRow(target) !== null) return null;
  return target.closest<HTMLElement>('[role="tree"]');
}

/**
 * Why the confirm button is not offered yet. A file's action needs its current version, and
 * until that read lands there is nothing to refuse an overwrite with — so the dialog says which
 * of the two it is rather than leaving a dead button with no explanation. A folder has no
 * version to wait for.
 */
function FileActionVersionNote({ target }: { target: FileActionTarget | null }) {
  if (target === null || target.kind === "dir" || target.version !== null) return null;
  return (
    <p
      className={`text-xs ${target.reading ? "text-gray-500 dark:text-gray-400" : toneInk.danger}`}
    >
      {target.reading ? S.files.actionVersionReading : S.files.actionVersionFailed}
    </p>
  );
}

/** An entry a rename or a delete has been asked about, and how far the read of its version got. */
interface FileActionTarget {
  path: string;
  /** A folder has no version marker: it is renamed whole, with nothing to read first. */
  kind: "file" | "dir";
  /** Non-null once a file's version is known; a file's action is refused until then. */
  version: string | null;
  /** True while the read is still in flight — which is what tells "not yet" from "could not". */
  reading: boolean;
}

/** Whether the dialog's action can run: a folder's at once, a file's once its version is known. */
function actionReady(target: FileActionTarget | null): boolean {
  return target !== null && (target.kind === "dir" || target.version !== null);
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
  scope,
  openRequest,
  active,
  reloadSignal,
  onAddReference,
}: {
  /**
   * The Workspace on screen: a Session's (the chat page), or a directory named by its path (the
   * new-chat draft's chosen folder). Changing it starts the panel over, as a Session switch does.
   */
  scope: FilesScope;
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
  /**
   * Stages what the panel contributes in the composer as a chip: a file, a directory, or a
   * quoted range. All three are whole things rather than words in a sentence, so none of them
   * is spliced into the draft the user is writing.
   */
  onAddReference: (reference: ComposerReference) => void;
}) {
  // Whether the HTML preview lands on a separate origin. True routes both the in-app
  // rendered view and "open in new tab" through the preview origin; false downgrades
  // the new tab to the same-origin sandbox (which the link flags rather than failing
  // silently in the page) and the in-app rendered view to the srcDoc fallback.
  const { previewIsolated: serverPreviewIsolated, desktopMode, sessionVia } = useAuth();
  const saveShortcut = useShortcutLabel("editor.save");
  // The desktop app's own window is the one page whose machine IS the server's, so it is the
  // only one offered "show in folder" — see lib/account-menu.ts for why a browser signed into
  // the same server, even on this machine, must not be.
  const isShellWindow = isDesktopShellWindow({ desktopMode, sessionVia });
  const scopeKey = filesScopeKey(scope);
  // Keyed by the scope's identity, not the object: the parent builds a fresh one every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const files = useMemo(() => filesApi(scope), [scopeKey]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  // A directory scope has no separate preview origin (its tokens name a Session), so its HTML
  // takes the same-origin sandbox the panel falls back to whenever isolation is off.
  const previewIsolated = serverPreviewIsolated && files.isolatablePreviews;
  const previewIsolatedRef = useRef(previewIsolated);
  previewIsolatedRef.current = previewIsolated;

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
  /** The search box's text. Deliberately not persisted: a search is a thing you are doing, not a setting. */
  const [query, setQuery] = useState("");
  /**
   * The server's answer for the query the box currently holds — null while none has arrived for
   * it, which is also how the tree tells "still looking" from "nothing there".
   */
  const [searchResult, setSearchResult] = useState<{
    hits: WorkspaceSearchHit[];
    truncated: boolean;
  } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Which search each in-flight answer belongs to; an older one must not overwrite a newer. */
  const searchSeq = useRef(0);
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
  /**
   * The file a rename or a delete is being asked about, and the version it carried when the
   * dialog opened.
   *
   * The version is read at the dialog rather than taken from whatever the preview last loaded:
   * what it guards is the Agent rewriting the file while the question is on screen, and a
   * marker from five minutes ago would refuse actions nobody needed warning about. Until it
   * arrives the action is not offered at all — an unconditional move or delete is exactly the
   * thing this is here to prevent.
   */
  const [renameTarget, setRenameTarget] = useState<FileActionTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [removeTarget, setRemoveTarget] = useState<FileActionTarget | null>(null);
  const [fileActionBusy, setFileActionBusy] = useState(false);
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
  /** The dragged tree width, or null while the user has never dragged it (the computed default stands). */
  const [treeWidthPref, setTreeWidthPref] = useState<number | null>(() => readTreeWidth());
  /** Soft wrap, shared by the source view and the editor so Edit reflows nothing (see parseWrapLines). */
  const [wrapLines, setWrapLines] = useState(() => readWrapLines());
  /**
   * The preview header's copy action. Driven by the hook rather than a plain CopyButton
   * because the tooltip is a Tooltip panel here, not a `title`, and a trigger may carry only
   * one of the two — the glyph swap and the live region are the ones CopyButton uses.
   */
  const { copied, flash: flashCopy } = useCopied();
  const [width, setWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // ----------------------------------------------------------------------- context menus
  // One hook per surface, not per row: each carries a long-press timer, and the tree draws
  // hundreds of rows — twice over while a closing subtree animates out. The row a gesture
  // landed on is resolved from the event instead, and held here for as long as its menu is up.
  const treeMenu = useRowContextMenu();
  /** A row the menu was opened on, or the blank space under the rows ("blank": the root). */
  const [treeMenuTarget, setTreeMenuTarget] = useState<FileMenuTarget | "blank" | null>(null);
  /** The tree header's New menu. */
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  /** The New dialog: what it creates, in which directory, and the name typed so far. */
  const [createTarget, setCreateTarget] = useState<{ kind: "file" | "dir"; dir: string } | null>(
    null,
  );
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const previewMenu = useRowContextMenu();
  /** The selection the preview's menu was opened over; null when there was none inside it. */
  const [menuSelection, setMenuSelection] = useState<PreviewSelection | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  /** Where the source view was scrolled when Edit was pressed: the editor opens there. */
  const editorOpening = useRef<EditorScroll | undefined>(undefined);
  /** The editor's scroll box, read on the way out of the editor. */
  const editorHost = useRef<HTMLDivElement | null>(null);
  /** Where the source view takes up once it is back on screen after the editor. */
  const bodyScrollOnReturn = useRef<EditorScroll | null>(null);
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

  // Scope changed (another Session, or the draft's folder re-picked): back to a fresh root with
  // no preview. Reset during render (React's documented "adjust state when a prop changes"
  // pattern), not in an effect — an effect-based reset lets one frame commit in which the old
  // scope's preview renders against the new one, flipping the isolated iframe's src to the new
  // session + the old path and firing a doomed request. Bumping previewSeq also invalidates
  // any in-flight previewPath from the old scope (its present() guard fails). An editor draft
  // survives in unsavedDrafts and comes back when the file is opened again.
  const [renderedScopeKey, setRenderedScopeKey] = useState(scopeKey);
  if (renderedScopeKey !== scopeKey) {
    setRenderedScopeKey(scopeKey);
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
    setNewMenuOpen(false);
    setCreateTarget(null);
    setRenameTarget(null);
    setRemoveTarget(null);
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

  // The tree pane's width: dragged if it ever was, otherwise the computed default, and
  // either way within the bounds this panel width allows.
  const treeWidth = clampTreeWidth(treeWidthPref ?? defaultTreeWidth(width), width);

  // --------------------------------------------------------------------------- loading

  /**
   * Fetches one directory's listing into the tree. Resolves true when it published; false
   * when it failed or was superseded (a newer request for the same directory, or a Session
   * switch). The root's failure shows in the tree; a nested directory that fails to list
   * (deleted mid-turn) toasts and leaves the tree.
   */
  const loadDir = useCallback(
    async (dir: string): Promise<boolean> => {
      const key = scopeKey;
      const seq = (dirSeq.current.get(dir) ?? 0) + 1;
      dirSeq.current.set(dir, seq);
      const current = () => scopeKeyRef.current === key && dirSeq.current.get(dir) === seq;
      setLoadingDirs((s) => new Set(s).add(dir));
      try {
        const res = await files.list(dir);
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
    [scopeKey, files],
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
      const key = scopeKey;
      const name = baseName(filePath);
      const kind = previewKindFor(name);
      const nonce = ++previewSeq;
      /** Publishes this call's result unless a newer previewPath call has started since:
       *  two rapid calls interleave across the await, and the late loser must not
       *  overwrite the winner's preview. */
      const present = (p: Preview) => {
        if (nonce === previewSeq && scopeKeyRef.current === key) setPreview(p);
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
        const result = await fetchTextPreview(files.fileUrl(filePath), kind === "unknown");
        if (result === null) {
          if (!refresh) present({ path: filePath, name, kind: "unsupported", nonce });
          return;
        }
        const { content, truncated, version } = result;
        // Oversized Markdown defaults to the source view: feeding the whole block to remark is a
        // main-thread cost the highlighting worker does nothing about (see MD_RENDER_LIMIT). The
        // reader can still switch to the rendered view, which makes it their informed choice.
        if (!refresh && kind === "md" && content.length > MD_RENDER_LIMIT && nonce === previewSeq) {
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
          scopeKeyRef.current === key &&
          editorRef.current?.path !== filePath
        ) {
          const stashKey = draftKey(key, filePath);
          const stashed = unsavedDrafts.get(stashKey);
          if (stashed === content) unsavedDrafts.delete(stashKey);
          else if (stashed !== undefined) {
            editorOpening.current = undefined;
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
    [scopeKey, files],
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
        const result = await fetchTextPreview(files.fileUrl(target), false);
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
  }, [preview, richView, previewIsolated, files]);

  // -------------------------------------------------------------- navigation and guards

  const promptDiscard = useCallback(
    () => new Promise<boolean>((resolve) => setDiscardPrompt({ resolve })),
    [],
  );

  const discardEditor = useCallback(() => {
    const current = editorRef.current;
    if (current !== null) unsavedDrafts.delete(draftKey(scopeKeyRef.current, current.path));
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
   * Puts one of the two entry actions on screen and, for a file, starts reading its current
   * version.
   *
   * The dialog opens first and the version lands in it: waiting for a round trip before showing
   * anything would make a menu click feel broken. A dirty editor is asked about before either,
   * through the same guard navigation uses, when the action moves its file out from under it: a
   * file's always, a folder's when the file being edited lies inside it.
   */
  const beginFileAction = useCallback(
    (path: string, action: "rename" | "delete", kind: "file" | "dir" = "file") => {
      const open = () => {
        const opened: FileActionTarget = { path, kind, version: null, reading: kind === "file" };
        if (action === "rename") {
          setRenameDraft(path);
          setRenameTarget(opened);
        } else {
          setRemoveTarget(opened);
        }
        if (kind === "dir") return;
        const settle = (version: string | null) => {
          const next = (t: FileActionTarget | null): FileActionTarget | null =>
            t !== null && t.path === path ? { path, kind, version, reading: false } : t;
          if (action === "rename") setRenameTarget(next);
          else setRemoveTarget(next);
        };
        void fetchFileVersion(filesRef.current.fileUrl(path))
          .then(settle)
          .catch(() => settle(null));
      };
      const editing = editorRef.current;
      if (kind === "dir" && (editing === null || !isWithin(editing.path, path))) open();
      else void navigateGuarded(null, open);
    },
    [navigateGuarded],
  );

  /**
   * Reports the failures the entry actions share. Nothing was changed, so this is a toast and
   * not a dialog: there is no decision left to take, only the same action again on the entry as
   * it now is.
   */
  const reportFileActionError = (err: unknown, path: string, to?: string): void => {
    if (err instanceof ApiError && err.code === "file_changed") {
      toastError(S.files.changedBeforeAction(baseName(path)));
    } else if (err instanceof ApiError && err.code === "target_exists" && to !== undefined) {
      toastError(S.files.targetExists(to));
    } else {
      toastError(apiErrorText(err));
    }
  };

  /**
   * The entry did not stop existing, it moved, and the panel follows it rather than emptying:
   * the open folders, their loaded listings, the current directory and the selection carry over
   * to the new path, a file on screen is read again there, and a draft stashed for a file that
   * moved goes with it. The listings are re-read from the new paths — the refs are brought
   * forward first, since the refresh reads them before the state lands.
   */
  const followMove = (from: string, to: string): void => {
    const expandedNext = movedSet(expandedRef.current, from, to);
    const listingsNext = movedListings(listingsRef.current, from, to);
    expandedRef.current = expandedNext;
    listingsRef.current = listingsNext;
    setExpanded(expandedNext);
    setListings(listingsNext);
    const selectedNext = selectedPath === null ? null : movedPath(selectedPath, from, to);
    if (selectedNext !== null) {
      setSelectedPath(selectedNext);
      setCurrentDir(parentDir(selectedNext));
    } else {
      const dirNext = movedPath(currentDirRef.current, from, to);
      if (dirNext !== null) setCurrentDir(dirNext);
    }
    const open = previewRef.current?.path;
    const openNext = open === undefined ? null : movedPath(open, from, to);
    if (openNext !== null) void previewPath(openNext, { refresh: true });
    const prefix = draftKey(scopeKey, "");
    for (const [key, text] of [...unsavedDrafts]) {
      const next = key.startsWith(prefix) ? movedPath(key.slice(prefix.length), from, to) : null;
      if (next === null) continue;
      unsavedDrafts.delete(key);
      unsavedDrafts.set(draftKey(scopeKey, next), text);
    }
    refreshAll();
    void locate(selectedNext ?? to);
  };

  const applyRename = async (): Promise<void> => {
    const target = renameTarget;
    const to = newEntryName(renameDraft);
    if (target === null || !actionReady(target) || fileActionBusy) return;
    if (to === "" || to === target.path) {
      setRenameTarget(null);
      return;
    }
    setFileActionBusy(true);
    try {
      await files.move({
        from: target.path,
        to,
        ...(target.kind === "file" && target.version !== null ? { ifVersion: target.version } : {}),
      });
      setRenameTarget(null);
      followMove(target.path, to);
      toastSuccess(S.files.renamed(baseName(to)));
    } catch (err) {
      reportFileActionError(err, target.path, to);
    } finally {
      setFileActionBusy(false);
    }
  };

  const applyDelete = async (): Promise<void> => {
    const target = removeTarget;
    if (target === null || target.version === null || fileActionBusy) return;
    setFileActionBusy(true);
    try {
      await filesRef.current.remove(target.path, target.version);
      setRemoveTarget(null);
      if (selectedPath === target.path) setSelectedPath(null);
      refreshAll();
      toastSuccess(S.files.deleted(baseName(target.path)));
    } catch (err) {
      reportFileActionError(err, target.path);
    } finally {
      setFileActionBusy(false);
    }
  };

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
      if (scopeKeyRef.current === scopeKey) setScrollTo({ path });
    },
    [loadDir, scopeKey],
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
  // The file being edited is version-checked first. An editor holding nothing of the user's
  // follows the file the way a code editor does: it takes the Agent's text, and the editor
  // keeps the caret's line and the scroll (WorkspaceFileEditor). One with unsaved changes is
  // never re-read — that would put the Agent's text under the user's hands — but silence until
  // the save would leave the user typing into a file that has already moved, so the editor says
  // so as soon as the turn lands, and the save's precondition turns into the conflict question.
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
    const key = scopeKeyRef.current;
    const source = filesRef.current;
    const flagChanged = (version: string) =>
      // Compared against the editor as it stands now, not the one captured above: it may have
      // been closed and reopened on the Agent's own version while this was in flight, and that
      // editor is not stale.
      setEditor((e) =>
        e !== null && e.path === open && e.version !== version && scopeKeyRef.current === key
          ? { ...e, changedOnDisk: true }
          : e,
      );
    void (async () => {
      try {
        const version = await fetchFileVersion(source.fileUrl(open));
        if (version === null || editorRef.current?.version === version) return;
        if (isDirty(editorRef.current)) {
          flagChanged(version);
          return;
        }
        const result = await fetchTextPreview(source.fileUrl(open), false);
        if (scopeKeyRef.current !== key) return;
        // A file grown past what the editor can hold whole cannot be taken in: say it moved.
        if (result === null || result.truncated) {
          flagChanged(version);
          return;
        }
        setEditor((e) => {
          if (e === null || e.path !== open || e.version === result.version) return e;
          // Typed into while the read was in flight: the text is the user's now.
          if (isDirty(e)) return { ...e, changedOnDisk: true };
          return {
            ...e,
            baseline: result.content,
            draft: result.content,
            version: result.version,
            changedOnDisk: false,
          };
        });
        setPreview((p) =>
          p !== null && p.path === open
            ? { ...p, content: result.content, truncated: false, version: result.version }
            : p,
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
  /**
   * The search runs on the server, over the whole Workspace — not over the rows the lazy tree
   * happens to have loaded, which made a match reachable only if its ancestors were already
   * open. Debounced because every keystroke would otherwise walk the tree again, and sequenced
   * because a slower answer for a shorter query must not land on top of a newer one.
   */
  useEffect(() => {
    const needle = query.trim();
    if (needle === "") {
      searchSeq.current += 1;
      setSearchResult(null);
      setSearchError(null);
      return;
    }
    const run = (searchSeq.current += 1);
    const timer = setTimeout(() => {
      void files
        .search(needle)
        .then((res) => {
          if (searchSeq.current !== run) return;
          setSearchResult({ hits: res.hits, truncated: res.truncated });
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (searchSeq.current !== run) return;
          setSearchResult(null);
          setSearchError(apiErrorText(e));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, files]);

  const openDirForFilter = useCallback(
    (dir: string) => {
      setCurrentDir(dir);
      setExpanded((s) => withExpanded(s, dir, true));
      if (!listingsRef.current.has(dir)) void loadDir(dir);
    },
    [loadDir],
  );

  /** A directory hit is somewhere to go, not something to unfold: opening one leaves the search behind and lands the tree there. */
  const openDirFromSearch = useCallback(
    (dir: string) => {
      setQuery("");
      openDirForFilter(dir);
    },
    [openDirForFilter],
  );

  const backToTree = (): void => {
    void navigateGuarded(null, () => {
      setSelectedPath(null);
      setPreview(null);
    });
  };

  const setTree = (visible: boolean): void => {
    setTreeVisible(visible);
    writeTreeVisible(visible);
  };

  const setWrap = (wrap: boolean): void => {
    setWrapLines(wrap);
    writeWrapLines(wrap);
  };

  // ----------------------------------------------------------------------------- editing

  /**
   * Opens the editor on the file in the preview, where the preview was: the source view's
   * scroll is read before anything awaits, and the editor opens at it with the caret at the
   * start of the first line in view (WorkspaceFileEditor), so Edit moves nothing on screen.
   */
  const startEdit = async (): Promise<void> => {
    const current = previewRef.current;
    if (current === null || !canEditPreview(current)) return;
    const body = previewBodyRef.current;
    const at = body === null ? undefined : { top: body.scrollTop, left: body.scrollLeft };
    // Content and version are read together and stored together, so one missing means both
    // are: an isolated HTML preview mounted without its text. Read it now, and refuse a
    // file the bounded read cannot hold whole — saving a partial text back would truncate
    // the file.
    let content = current.content;
    let version = current.version;
    if (content === undefined || version === undefined) {
      try {
        const result = await fetchTextPreview(files.fileUrl(current.path), false);
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
    editorOpening.current = at;
    setEditor({ path: current.path, baseline: content, draft: content, version });
  };

  // A file the New dialog just made: the editor opens on it as soon as its preview lands. Read
  // off the committed preview, since that is what startEdit opens the editor on.
  const editOnOpen = useRef<string | null>(null);
  useEffect(() => {
    if (preview === null || editOnOpen.current !== preview.path) return;
    editOnOpen.current = null;
    if (editorRef.current === null) void startEdit();
    // startEdit is this render's own; the preview landing is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const updateDraft = (draft: string): void => {
    const current = editorRef.current;
    if (current === null) return;
    setEditor({ ...current, draft });
    const key = draftKey(scopeKey, current.path);
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
   *
   * A save that lands leaves the editor open, as a code editor does: nothing remounts it, so
   * the caret, the selection and the scroll stay where they were. What was written becomes the
   * baseline — anything typed while the write was in flight stays unsaved on top of it — and
   * the version the write produced is the next save's precondition. A server that reports no
   * version leaves nothing safe to save against, so there the editor closes and the next Edit
   * reads the file again.
   */
  const save = async (opts?: { overwrite?: boolean }): Promise<void> => {
    setSaveConfirm(false);
    setConflict(null);
    const current = editorRef.current;
    if (current === null) return;
    const sent = current.draft;
    const blob = new Blob([sent]);
    if (blob.size > WORKSPACE_UPLOAD_LIMIT_MB * MB_BYTES) {
      toastError(S.files.saveTooLarge(WORKSPACE_UPLOAD_LIMIT_MB));
      return;
    }
    const key = scopeKey;
    setSaving(true);
    try {
      const written = await files.write(
        current.path,
        await blobToBase64(blob),
        opts?.overwrite ? undefined : current.version,
      );
      if (scopeKeyRef.current !== key) return;
      const stash = draftKey(key, current.path);
      if (written === null) {
        unsavedDrafts.delete(stash);
        setEditor(null);
      } else {
        setEditor((e) =>
          e !== null && e.path === current.path
            ? { ...e, baseline: sent, version: written, changedOnDisk: false }
            : e,
        );
        if (editorRef.current?.draft === sent) unsavedDrafts.delete(stash);
      }
      // The preview holds what was written; a fresh nonce remounts an HTML iframe onto it.
      const nonce = ++previewSeq;
      setPreview((p) =>
        p !== null && p.path === current.path
          ? { ...p, content: sent, truncated: false, version: written ?? undefined, nonce }
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
      if (scopeKeyRef.current !== key) return;
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
      if (scopeKeyRef.current === key) setSaving(false);
    }
  };

  /**
   * Leaves the editor for the source view, asking first when there are unsaved changes. The
   * source view comes back where the editor was scrolled, not where it was before Edit.
   */
  const stopEditing = (): void => {
    const host = editorHost.current;
    const at = host === null ? null : { top: host.scrollTop, left: host.scrollLeft };
    void navigateGuarded(null, () => {
      bodyScrollOnReturn.current = at;
    });
  };

  // ------------------------------------------------------------------------------ upload

  const doUpload = async (picked: File[], dir: string): Promise<void> => {
    const key = scopeKey;
    setUploading({ done: 0, total: picked.length });
    const uploaded: string[] = [];
    try {
      for (const [i, file] of picked.entries()) {
        const b64 = await blobToBase64(file);
        await files.write(joinWorkspacePath(dir, file.name), b64);
        if (scopeKeyRef.current !== key) return;
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
        setUploading({ done: i + 1, total: picked.length });
      }
      toastSuccess(S.files.uploadedCount(uploaded.length));
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      if (scopeKeyRef.current === key) setUploading(null);
    }
    if (scopeKeyRef.current !== key || uploaded.length === 0) return;
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
    const key = scopeKey;
    if (!listingsRef.current.has(dir) && !(await loadDir(dir))) return;
    if (scopeKeyRef.current !== key) return;
    const existing = new Set((listingsRef.current.get(dir) ?? []).map((entry) => entry.name));
    const clashes = accepted.filter((f) => existing.has(f.name)).map((f) => f.name);
    if (clashes.length > 0) setPendingUpload({ files: accepted, clashes, dir });
    else void doUpload(accepted, dir);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (picked.length > 0) void stageUpload(picked, currentDirRef.current);
  };

  /** The menu's own picker: same staging, but into the folder that was right-clicked. */
  const onMenuPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (picked.length > 0) void stageUpload(picked, menuUploadDir.current);
  };

  // --------------------------------------------------------------------------------- new

  /**
   * Opens the New dialog for a text file or a folder in `dir`. A text file starts as
   * `untitled.txt` with the stem selected, so typing replaces the name and keeps the extension;
   * a folder starts empty.
   */
  const beginCreate = (kind: "file" | "dir", dir: string): void => {
    setCreateName(kind === "file" ? DEFAULT_TEXT_FILE_NAME : "");
    setCreateTarget({ kind, dir });
  };

  /**
   * Creates what the dialog names. An existing name is refused by the server with nothing
   * written, and the dialog stays open on the name so it can be changed. A new folder opens in
   * the tree and becomes the current directory, so the next upload or New lands in it. A new
   * text file opens in the editor — unless the editor holds typed changes, which a new file is
   * no reason to ask about (the rule uploads follow): then it is only shown in the tree.
   */
  const applyCreate = async (): Promise<void> => {
    const target = createTarget;
    const name = newEntryName(createName);
    if (target === null || name === "" || creating) return;
    const path = joinWorkspacePath(target.dir, name);
    const key = scopeKey;
    setCreating(true);
    try {
      await files.create({ path, kind: target.kind });
      if (scopeKeyRef.current !== key) return;
      setCreateTarget(null);
      toastSuccess(S.files.created(baseName(path)));
      if (target.kind === "dir") {
        setCurrentDir(path);
        setExpanded((s) => withExpanded(s, path, true));
        await locate(path);
        if (scopeKeyRef.current === key) void loadDir(path);
        return;
      }
      if (isDirty(editorRef.current)) {
        await locate(path);
        return;
      }
      editOnOpen.current = path;
      openFile(path, { locate: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "target_exists") {
        toastError(S.files.targetExists(path));
      } else {
        toastError(apiErrorText(err));
      }
    } finally {
      if (scopeKeyRef.current === key) setCreating(false);
    }
  };

  /**
   * Asks the server to show the file in the machine's file manager. Only the shell's own
   * window offers this, so a refusal here is a real failure — no file manager on the box, or
   * a command that would not start — and it is reported rather than swallowed. Nothing on
   * screen changes either way: the window that opens is not this one.
   */
  const revealInFolder = async (filePath: string): Promise<void> => {
    try {
      await files.reveal(filePath);
    } catch (err) {
      toastError(apiErrorText(err));
    }
  };

  // ------------------------------------------------------------------------ context menus

  const copyPath = (target: FileMenuTarget): void => {
    // A menu row cannot carry the copy button's own at-the-control feedback: the row acts and
    // the panel closes out from under it. A toast is the confirmation that survives that, and
    // it says the same word (sidebar.tsx's copy-id row does the same) — only once the write
    // has landed.
    void writeClipboard(target.path).then((ok) => ok && toastSuccess(S.common.copied));
  };

  const addToChat = (target: FileMenuTarget): void => {
    onAddReference({
      kind: target.kind,
      path: target.path,
      text: pathReference(target.path, target.kind),
    });
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
   * The tree's context menu, hung on the whole pane. A row opens the menu for its entry, and the
   * blank space under the rows opens the New menu for the Workspace root. A gesture on the
   * search box resolves no target, so nothing is suppressed and the browser's own menu stands,
   * which is what the search box needs to be pasteable into.
   */
  const treeMenuProps = {
    onContextMenu: (e: ReactMouseEvent) => {
      const row = hitRow(e.target);
      const blank = row === null ? hitBlank(e.target) : null;
      if (row === null && blank === null) return;
      // Before the hook reads it: the anchor for a keyboard-synthesized contextmenu is the
      // row's own box, and the hook measures whatever `rowRef` currently points at.
      treeMenu.rowRef(row?.el ?? blank);
      setTreeMenuTarget(row === null ? "blank" : { path: row.path, kind: row.kind });
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
      const blank = row === null ? hitBlank(e.target) : null;
      if (row === null && blank === null) return;
      treeMenu.rowRef(row?.el ?? blank);
      setTreeMenuTarget(row === null ? "blank" : { path: row.path, kind: row.kind });
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
   * resolve is whether a selection sits inside the preview — read at the gesture, by every
   * gesture that opens the menu, rather than when a row is clicked: focusing the menu can
   * collapse the live selection under it, and a selection read at the previous gesture may
   * since have been collapsed or belong to a file that is no longer open.
   */
  /**
   * Reads the selection the gesture landed on, and puts it back.
   *
   * Both halves are needed. Read, because focusing the menu can collapse the live selection,
   * so what the menu acts on has to be captured before the panel opens. Put back, because
   * that collapse is also visible: a right-click inside selected text would clear the
   * highlight the user made, on a gesture that was only asking what could be done with it.
   */
  const captureMenuSelection = (): void => {
    const host = previewBodyRef.current;
    const selection = readSelection(host, sourceLines(host));
    setMenuSelection(selection);
    if (selection !== null) restoreSelection(selection.range);
  };

  const openPreviewMenu = (e: ReactMouseEvent): void => {
    captureMenuSelection();
    previewMenu.rowProps.onContextMenu(e);
  };

  /** The keyboard's chord opens the same menu, so it re-reads the selection the same way. */
  const previewMenuKeyDown = (e: ReactKeyboardEvent): void => {
    if (isContextMenuKey(e)) captureMenuSelection();
    previewMenu.rowProps.onKeyDown(e);
  };

  /** Same as the row menu's: the preview's own links must not fire on the click a hold replays. */
  const previewMenuClickCapture = (e: ReactMouseEvent): void => {
    if (!previewMenu.consumeLongPressClick()) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const addSelectionToChat = (p: Preview, selection: PreviewSelection): void => {
    onAddReference({
      path: p.path,
      text: selectionBlock({
        path: p.path,
        language: languageForFileName(p.name),
        selection: selection.text,
        fromLine: selection.fromLine,
        toLine: selection.toLine,
      }),
      kind: "quote",
      ...(selection.fromLine === undefined || selection.toLine === undefined
        ? {}
        : { fromLine: selection.fromLine, toLine: selection.toLine }),
    });
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
    const dropped = pickDroppedFiles(e.dataTransfer);
    if (dropped.dirs.length > 0) toastError(S.files.folderDropSkipped(dropped.dirs.join(", ")));
    if (dropped.files.length > 0) void stageUpload(dropped.files, targetDir);
  };

  // ------------------------------------------------------------------------------ render

  const filter = query.trim();
  const rows = useMemo(
    () => (filter === "" ? flattenTree(listings, expanded) : searchRows(searchResult?.hits ?? [])),
    [listings, expanded, filter, searchResult],
  );
  const rootListing = listings.get("");
  /**
   * What the path strip names: the open file, or the current directory when none is open.
   * One strip rather than a directory row above a filename row — they are one fact, and the
   * two rows spent a whole line of a panel that can be very narrow saying it twice. The strip
   * fits tail first, so the file's own name is the last thing to go and the leading directories
   * collapse into a single "…" ahead of it.
   */
  const crumbTarget = selectedPath ?? currentDir;
  const crumbSegments =
    crumbTarget === "" ? [S.files.root] : [S.files.root, ...crumbTarget.split("/")];
  const crumbPath = crumbTarget === "" ? S.files.root : `${S.files.root}/${crumbTarget}`;
  const showTree = narrow ? selectedPath === null : treeVisible;
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
  const fileMenuLabels: WorkspaceFileMenuLabels = {
    copyPath: S.files.copyPath,
    addToChat: S.files.addToChat,
    addSelectionToChat: S.files.addSelectionToChat,
    uploadHere: S.files.uploadHere,
    download: S.files.download,
    rename: S.files.renameTitle,
    delete: S.common.delete,
    newTextFile: S.files.newTextFile,
    newFolder: S.files.newFolder,
  };

  // The tree pane: its body says, in order, that the root listing failed, that it is on its way,
  // that a search failed, and that a search's answer has not arrived yet — an empty list there
  // would read as "nothing matches", the one answer that must not be guessed.
  const tree = (
    <TreePane
      {...treeMenuProps}
      search={{
        value: query,
        onChange: setQuery,
        placeholder: S.files.searchPlaceholder,
        clearLabel: S.files.searchClear,
      }}
      actions={
        <>
          {/* New: a text file or a folder, in the current directory — the one the breadcrumbs
              name and uploads land in. */}
          <Dropdown
            open={newMenuOpen}
            setOpen={setNewMenuOpen}
            portal={{ direction: "down", align: "right" }}
            className="shrink-0"
            menuClass="w-max min-w-36"
            button={
              <button
                type="button"
                aria-label={S.files.newMenu}
                data-tooltip={S.files.newMenu}
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
                onClick={() => setNewMenuOpen(!newMenuOpen)}
                className={iconActionClass}
              >
                <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
              </button>
            }
          >
            <WorkspaceNewMenuRows
              labels={fileMenuLabels}
              onNewFile={() => {
                setNewMenuOpen(false);
                beginCreate("file", currentDirRef.current);
              }}
              onNewFolder={() => {
                setNewMenuOpen(false);
                beginCreate("dir", currentDirRef.current);
              }}
            />
          </Dropdown>
          <Tooltip label={S.files.refresh} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.files.refresh}
              onClick={refreshAll}
              className={iconActionClass}
            >
              <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.iconButton} />
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
                <Spinner size="sm" label={uploadLabel} />
              ) : (
                <GlyphIcon d={ICONS.upload} size={ICON_SIZE.iconButton} />
              )}
            </label>
          </Tooltip>
        </>
      }
      error={rootError ?? (rootListing === undefined ? null : searchError)}
      loading={rootError === null && rootListing === undefined}
      pending={filter !== "" && searchResult === null ? S.files.searching : null}
      note={
        searchResult?.truncated === true ? S.files.searchTruncated(searchResult.hits.length) : null
      }
      // The row menu, or the New menu for the blank space under the rows. The anchor is the point
      // the gesture landed on rather than any element of the pane, and the panel is portaled (the
      // same shape the sidebar's session row uses).
      menu={
        treeMenuTarget !== null && (
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
            menuClass="w-max min-w-36 max-w-[calc(100vw-2rem)]"
            button={null}
          >
            {treeMenuTarget === "blank" ? (
              <WorkspaceNewMenuRows
                labels={fileMenuLabels}
                onNewFile={() => {
                  closeTreeMenu();
                  beginCreate("file", "");
                }}
                onNewFolder={() => {
                  closeTreeMenu();
                  beginCreate("dir", "");
                }}
              />
            ) : (
              <WorkspaceFileMenuRows
                target={treeMenuTarget}
                labels={fileMenuLabels}
                downloadHref={(path) => files.fileUrl(path, true)}
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
                onNewFile={(dir) => {
                  closeTreeMenu();
                  beginCreate("file", dir);
                }}
                onNewFolder={(dir) => {
                  closeTreeMenu();
                  beginCreate("dir", dir);
                }}
                onRename={(t) => {
                  closeTreeMenu();
                  beginFileAction(t.path, "rename", t.kind);
                }}
                onDelete={(t) => {
                  closeTreeMenu();
                  beginFileAction(t.path, "delete");
                }}
                onClose={closeTreeMenu}
              />
            )}
          </Dropdown>
        )
      }
    >
      <WorkspaceTreeView
        rows={rows}
        selectedPath={selectedPath}
        currentDir={currentDir}
        loadingDirs={loadingDirs}
        dropTargetDir={drag.active ? drag.targetDir : null}
        scrollTo={scrollTo}
        rootEmpty={rootListing !== undefined && rootListing.length === 0}
        filtering={filter !== ""}
        toggled={filter === "" ? toggled : null}
        onToggleDir={filter === "" ? toggleDir : openDirFromSearch}
        onOpenFile={openFile}
      />
    </TreePane>
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
        <GlyphIcon d={ICONS.wrapText} size={ICON_SIZE.iconButton} />
      </button>
    </Tooltip>
  );

  const richToggle = preview !== null && (preview.kind === "html" || preview.kind === "md") && (
    <div className="flex shrink-0 rounded-md bg-gray-100 p-px dark:bg-gray-800">
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
          className={`whitespace-nowrap rounded px-2 py-0.5 text-xs transition-colors duration-150 ${
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

  /**
   * Copy and Edit, floated over the top-right of the file rather than parked in the title row
   * (PreviewPane draws the pill). Both act on the body underneath them — the text on screen —
   * while the row above names the file and carries what leaves it: the view toggle, wrap, the
   * external link and download.
   */
  const previewFloatingActions = preview !== null &&
    (wrapToggle !== false || canEdit || (sourceShown && preview.content !== undefined)) && (
      <>
        {/* Soft wrap is a property of the surface under the pill, and the editor lays its
            textarea over that same surface — so it rides here in both modes, which is also
            the only place the editor can reach it from. */}
        {wrapToggle}
        {/* Copies the text that was read, which is all of the file unless the preview was cut off. */}
        {sourceShown && preview.content !== undefined && (
          <>
            <Tooltip label={S.chat.copyCode} placement="bottom" className="shrink-0">
              <button
                type="button"
                aria-label={S.chat.copyCode}
                onClick={() => flashCopy(preview.content ?? "")}
                className={iconActionClass}
              >
                <CopyCheckGlyph copied={copied} size={ICON_SIZE.iconButton} />
              </button>
            </Tooltip>
            {/* Sibling, not a child: the button's accessible name stays the label, and the
                glyph swap is silent without this region. */}
            <CopiedStatus copied={copied} />
          </>
        )}
        {canEdit && (
          <Tooltip label={S.common.edit} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.common.edit}
              onClick={() => void startEdit()}
              className={iconActionClass}
            >
              <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
        )}
        {/* rel="noopener noreferrer" is load-bearing, not boilerplate: the preview must not
            keep a handle back to this window, which is the whole point of serving it from a
            separate origin.

            Without a separate preview origin the page opens sandboxed, and the caveat joins
            the name rather than riding a ⚠ beside it: the name is all an icon-only control
            has, and the tooltip shows the same words so the two cannot disagree. The tint is
            a second carrier, never the only one. */}
        {/\.html?$/i.test(preview.name) && (
          <Tooltip label={openInNewTabLabel} placement="bottom" className="shrink-0">
            <a
              href={files.previewUrl(preview.path)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={openInNewTabLabel}
              className={`${iconActionClass} ${previewIsolated ? "" : toneInk.attention}`}
            >
              <GlyphIcon d={ICONS.externalLink} size={ICON_SIZE.iconButton} />
            </a>
          </Tooltip>
        )}
      </>
    );

  /** A part of the view still on its way, or the fetch that failed to bring it. */
  const pendingSource = (): PreviewView =>
    sourceError !== null ? { kind: "error", message: sourceError } : { kind: "loading" };

  /** What the preview pane draws for the file on screen. */
  const previewViewOf = (p: Preview): PreviewView => {
    const truncatedNote = p.truncated === true ? S.files.previewTruncated : undefined;
    if (p.kind === "image") {
      // Keyed on the nonce like the isolated HTML iframe: the src alone is unchanged when the
      // same file is re-read, so only a remount re-requests the bytes the agent just rewrote.
      return {
        kind: "image",
        src: files.fileUrl(p.path),
        alt: p.name,
        reloadKey: p.nonce,
      };
    }
    if (p.kind === "pdf") {
      return {
        kind: "pdf",
        src: files.fileUrl(p.path),
        title: p.name,
        reloadKey: p.nonce,
      };
    }
    if (p.kind === "html" && richView === "rendered") {
      if (previewIsolated) {
        return {
          kind: "embed",
          node: (
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
            // re-opened after the agent rewrote it.
            <iframe
              key={p.nonce}
              src={files.previewUrl(p.path)}
              title={p.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
            />
          ),
        };
      }
      // Only reachable without content when previewIsolated flipped to false after an
      // isolated preview mounted without it: the lazy source effect is already fetching it,
      // and the srcDoc fallback renders once it lands.
      if (p.content === undefined) return pendingSource();
      return {
        kind: "embed",
        node: (
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
        ),
      };
    }
    if (p.kind === "md" && richView === "rendered") {
      // Markdown's default rendered view: the reading box and pipeline message bodies use
      // (static HTML with no script execution surface, so no iframe sandbox is needed), with
      // the image and link adapters swapped for ones that know the Workspace.
      return {
        kind: "markdown",
        text: p.content ?? "",
        truncatedNote,
        components: {
          // Relative images are resolved against the md file's directory into the file API
          // (otherwise resolving against the app's origin would always 404). `v` is the read
          // nonce, not a cache-buster for its own sake: a Workspace image is rewritten under
          // the same path, and without it a re-read of the Markdown would keep painting the
          // previous bytes from the browser's image cache.
          img: ({ src, alt }) => (
            <img
              src={
                typeof src === "string" && !EXTERNAL_REF_RE.test(src)
                  ? `${files.fileUrl(resolveRelative(parentDir(p.path), src))}&v=${p.nonce}`
                  : src
              }
              alt={alt ?? ""}
              loading="lazy"
              className="max-w-full"
            />
          ),
          // External links open in a new tab; relative links point to a Workspace file,
          // clicking opens it in the tree and the preview; in-page anchors keep default behavior.
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
                href={files.fileUrl(target)}
                onClick={(e) => {
                  e.preventDefault();
                  openFile(target, { locate: true });
                }}
              >
                {children}
              </a>
            );
          },
        },
      };
    }
    if (p.kind === "text" || p.kind === "html" || p.kind === "md") {
      // Isolated HTML reaches the Source view before its lazy fetch lands: a skeleton (or the
      // fetch's own error) — toggling back to Rendered is unaffected, and re-entering Source
      // retries the fetch.
      if (p.content === undefined) return pendingSource();
      // The text itself, with no box around it — the same surface the editor lays its
      // textarea over, so Edit changes what you can do and nothing about what you see.
      // Wrapping is the Wrap toggle's business here; the message stream's own code blocks
      // still scroll sideways rather than wrap, which is a transcript's answer and not a file
      // viewer's.
      return {
        kind: "source",
        code: p.content,
        language: languageForFileName(p.name),
        wrap: wrapLines,
        truncatedNote,
      };
    }
    return { kind: "unsupported", message: S.files.previewUnsupported };
  };

  /**
   * What the path row offers for the file it names. A draft takes the row over: its two
   * decisions, and the state behind them, are the whole of what the row is for while one is
   * open, and a view toggle would be offering a view the draft is not in. Everything that
   * acts on the text rather than on the file rides the floating pill over it instead.
   */
  const fileRowActions =
    preview !== null &&
    preview.path === selectedPath &&
    (editor !== null && editor.path === preview.path ? (
      <>
        {editor.changedOnDisk === true && (
          <span
            className={`shrink-0 text-xs ${toneInk.attention}`}
            data-tooltip={S.files.changedOnDiskHint}
          >
            {S.files.changedOnDisk}
          </span>
        )}
        {dirty && (
          <span className={`shrink-0 text-xs ${toneInk.attention}`}>{S.files.unsaved}</span>
        )}
        {/* Icon buttons, not text ones, so the row is the same height whether or not a draft
            is open: a `Button size="sm"` stands 29px against these 27px, and the header would
            grow by two pixels the moment Edit was pressed. The save keeps no primary tint —
            it opens a confirmation whose own button carries that weight. */}
        <Tooltip label={S.files.stopEditing} placement="bottom" className="shrink-0">
          <button
            type="button"
            aria-label={S.files.stopEditing}
            onClick={stopEditing}
            disabled={saving}
            className={`${iconActionClass} disabled:opacity-40`}
          >
            <CloseIcon size={ICON_SIZE.iconButton} />
          </button>
        </Tooltip>
        <Tooltip
          label={
            saving
              ? S.common.saving
              : `${S.common.save}${saveShortcut !== null ? ` (${saveShortcut})` : ""}`
          }
          placement="bottom"
          className="shrink-0"
        >
          <button
            type="button"
            aria-label={S.common.save}
            onClick={requestSave}
            disabled={saving}
            className={`${iconActionClass} disabled:opacity-40`}
          >
            {saving ? (
              <Spinner size="sm" label={S.common.saving} />
            ) : (
              <GlyphIcon d={STAT_ICONS.check} size={ICON_SIZE.iconButton} />
            )}
          </button>
        </Tooltip>
      </>
    ) : (
      <>
        {richToggle}
        <Tooltip label={S.files.download} placement="bottom" className="shrink-0">
          <a
            href={files.fileUrl(preview.path, true)}
            download={preview.name}
            aria-label={S.files.download}
            className={iconActionClass}
          >
            <GlyphIcon d={ICONS.download} size={ICON_SIZE.iconButton} />
          </a>
        </Tooltip>
        {isShellWindow && (
          <Tooltip label={S.files.revealInFolder} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.files.revealInFolder}
              onClick={() => void revealInFolder(preview.path)}
              className={iconActionClass}
            >
              <GlyphIcon d={ICONS.folderOpen} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
        )}
      </>
    ));

  /** The preview on screen: the loaded file, once it is the one the tree has selected. */
  const shown = preview !== null && preview.path === selectedPath ? preview : null;
  const editing = shown !== null && editor !== null && editor.path === shown.path ? editor : null;
  const previewView: PreviewView =
    selectedPath === null
      ? {
          kind: "empty",
          title: S.files.selectFile,
          action:
            !treeVisible && !narrow ? (
              <Button size="sm" onClick={() => setTree(true)}>
                {S.files.showTree}
              </Button>
            ) : undefined,
        }
      : shown === null
        ? { kind: "opening" }
        : previewViewOf(shown);
  const selection = menuSelection;

  const previewPane = (
    <PreviewPane
      view={previewView}
      actions={previewFloatingActions}
      editor={
        editing !== null && (
          <WorkspaceFileEditor
            path={editing.path}
            value={editing.draft}
            label={S.files.editorLabel(baseName(editing.path))}
            wrap={wrapLines}
            // The editor colours whatever it can hold: tokenizing runs on a worker, so a large
            // file costs latency on the colours rather than a stalled editor, and a ceiling of
            // its own would only refuse to colour a file for no gain. The bound left is the
            // preview cap, which is all a load can put here.
            highlight={editing.draft.length <= TEXT_PREVIEW_LIMIT}
            initialScroll={editorOpening.current}
            hostRef={editorHost}
            onChange={updateDraft}
            onSave={requestSave}
            // The editor.save binding (⌘S / Ctrl+S by default), read from the keymap at the
            // keystroke so a rebinding in the settings takes effect without a remount.
            isSaveKey={(event) => isShortcut(event, keymap(), "editor.save", currentPlatform())}
          />
        )
      }
      bodyRef={(el) => {
        previewBodyRef.current = el;
        // The same element is the menu's keyboard anchor and its scroll owner: a scroll of this
        // box moves the point the panel hangs off.
        previewMenu.rowRef(el);
        // Back from the editor: the source view takes up where the editor was scrolled. Both
        // lay out the same surface, so one offset is one line in either.
        const at = bodyScrollOnReturn.current;
        if (el !== null && at !== null) {
          bodyScrollOnReturn.current = null;
          el.scrollTop = at.top;
          el.scrollLeft = at.left;
        }
      }}
      bodyProps={{
        onContextMenu: openPreviewMenu,
        onKeyDown: previewMenuKeyDown,
        onPointerDown: (e) => {
          // Only the press-and-hold path can open the menu from here, and only it is worth
          // walking the rendered lines for: an ordinary click would pay that on every click.
          if (isLongPressPointer(e.pointerType)) captureMenuSelection();
          previewMenu.rowProps.onPointerDown(e);
        },
        onPointerMove: previewMenu.rowProps.onPointerMove,
        onPointerUp: previewMenu.rowProps.onPointerUp,
        onPointerCancel: previewMenu.rowProps.onPointerCancel,
        onClickCapture: previewMenuClickCapture,
      }}
      // The same menu the file's own tree row offers, plus the selection entry while there is
      // one. A right-click inside the HTML or PDF preview never arrives here — those are
      // iframes, and nothing on this side of them can hear it — so the menu is what the
      // surrounding preview chrome offers.
      menu={
        shown !== null && (
          <Dropdown
            open={previewMenu.open}
            setOpen={previewMenu.setOpen}
            portal={{ direction: "down", align: "left" }}
            anchorRect={previewMenu.anchor}
            anchorOwner={previewMenu.anchorOwner}
            returnFocus={previewMenu.anchorOwner}
            className="contents"
            menuClass="w-max min-w-36 max-w-[calc(100vw-2rem)]"
            button={null}
          >
            <WorkspaceFileMenuRows
              target={{ path: shown.path, kind: "file" }}
              labels={fileMenuLabels}
              downloadHref={(path) => files.fileUrl(path, true)}
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
                      addSelectionToChat(shown, selection);
                    }
              }
              onRename={(t) => {
                previewMenu.close();
                beginFileAction(t.path, "rename");
              }}
              onDelete={(t) => {
                previewMenu.close();
                beginFileAction(t.path, "delete");
              }}
              onClose={previewMenu.close}
            />
          </Dropdown>
        )
      }
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* The panel's one header row: the way back or the tree toggle, the path of whatever is
          open, and what that file offers. It never wraps — the path strip absorbs all of the
          pressure, clipping and collapsing its leading segments, while the actions keep their
          width. Everything that acts on the text rather than on the file is in the floating
          pill over the body, and the panel's own actions (refresh, upload) sit in the tree
          pane's header beside its search box. */}
      <div className="flex shrink-0 flex-nowrap items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
        {narrow && !showTree && (
          <Tooltip label={S.files.backToList} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.files.backToList}
              onClick={backToTree}
              className={iconActionClass}
            >
              <GlyphIcon d={ICONS.chevronLeft} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
        )}
        {!narrow && (
          // Static accessible name, state on aria-pressed alone: a name that swaps Show/Hide
          // beside it reads as "Hide file tree, pressed", saying the state twice and
          // disagreeing with itself. The tooltip may still swap — it is presentation only.
          <button
            type="button"
            aria-pressed={treeVisible}
            data-tooltip={treeVisible ? S.files.hideTree : S.files.showTree}
            aria-label={S.files.showTree}
            onClick={() => setTree(!treeVisible)}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors duration-150 ${
              treeVisible
                ? "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <GlyphIcon d={ICONS.panelLeft} size={ICON_SIZE.iconButton} />
          </button>
        )}
        {/* The path, read out and not navigable: the tree beside it is what navigates, and a
            second way in would only be a second thing to keep in step with the editor's
            unsaved-changes guard. `flex-1` over a zero basis, so the strip measures the room
            the actions leave it and never its own content. */}
        <Breadcrumbs
          className="flex-1"
          items={crumbSegments.map((label) => ({ label }))}
          title={crumbPath}
        />
        {fileRowActions}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {narrow ? (
          // Narrow: one column, tree or preview.
          showTree ? (
            tree
          ) : (
            previewPane
          )
        ) : (
          // Wide: the tree and the handle beside it stay mounted and slide in and out of the
          // panel's left edge, and the preview takes the room they leave.
          <SplitPane
            className="min-w-0 flex-1"
            size={treeWidth}
            min={TREE_MIN_WIDTH}
            // Before the first measurement there is no ceiling yet (clampTreeWidth applies
            // none), so the current width is the honest maximum for that frame.
            max={Math.max(maxTreeWidth(width), treeWidth)}
            label={S.files.treeWidth}
            collapsed={!treeVisible}
            onResize={(px) => setTreeWidthPref(clampTreeWidth(px, width))}
            // Once per drag or key press, not per frame.
            onResizeEnd={(px) => writeTreeWidth(clampTreeWidth(px, width))}
            first={tree}
            second={previewPane}
          />
        )}
        {/* Drop feedback: a dashed frame over the panel and a label naming the directory the
            files will land in. Pure feedback — it keeps the hit test on the rows underneath,
            which is how a folder row can be the target. */}
        {drag.active && (
          <DropOverlay
            variant="frame"
            glyph={PAPERCLIP_ICON}
            title={S.files.dropToUpload(dirLabel(drag.targetDir))}
          />
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
        cancelLabel={S.common.cancel}
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
              <li
                key={name}
                className="truncate py-0.5 font-mono text-xs"
                data-tooltip={name}
                data-tooltip-content="code"
              >
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
        cancelLabel={S.common.cancel}
        busy={saving}
        onClose={() => setSaveConfirm(false)}
        onConfirm={() => void save()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.files.saveConfirm(editor !== null ? baseName(editor.path) : "")}
        </p>
      </ConfirmModal>

      {/* Rename or move: one field holding the whole Workspace-relative path, so a rename and a
          move are one action rather than two that differ only in how much of the path changed.
          A folder moves whole, with everything under it. */}
      <ConfirmModal
        open={renameTarget !== null}
        title={S.files.renameTitle}
        confirmLabel={S.files.renameConfirm}
        cancelLabel={S.common.cancel}
        confirmDisabled={!actionReady(renameTarget) || renameDraft.trim() === ""}
        busy={fileActionBusy}
        tone="primary"
        onClose={() => setRenameTarget(null)}
        onConfirm={() => void applyRename()}
      >
        <Input
          label={S.files.renameLabel}
          size="sm"
          value={renameDraft}
          hint={S.files.renameHint}
          autoFocus
          {...noAutofill}
          onChange={(e) => setRenameDraft(e.target.value)}
        />
        <FileActionVersionNote target={renameTarget} />
      </ConfirmModal>
      {/* New text file or folder: a name under the directory it goes in. Enter creates, as the
          button does; a name the server finds taken leaves the dialog open on it. */}
      <ConfirmModal
        open={createTarget !== null}
        title={createTarget?.kind === "dir" ? S.files.newFolder : S.files.newTextFile}
        tone="primary"
        confirmLabel={S.files.createConfirm}
        cancelLabel={S.common.cancel}
        confirmDisabled={newEntryName(createName) === ""}
        busy={creating}
        onClose={() => setCreateTarget(null)}
        onConfirm={() => void applyCreate()}
      >
        <Input
          label={createTarget?.kind === "dir" ? S.files.newFolderName : S.files.newFileName}
          size="sm"
          value={createName}
          hint={S.files.createHint(dirLabel(createTarget?.dir ?? ""))}
          autoFocus
          {...noAutofill}
          // Typing replaces the stem and keeps the extension (`untitled` of `untitled.txt`).
          onFocus={(e) => {
            const input = e.currentTarget;
            if (input.value === DEFAULT_TEXT_FILE_NAME)
              input.setSelectionRange(0, stemEnd(input.value));
          }}
          onChange={(e) => setCreateName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void applyCreate();
          }}
        />
      </ConfirmModal>
      <ConfirmModal
        open={removeTarget !== null}
        title={S.files.deleteTitle}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        confirmDisabled={removeTarget?.version == null}
        busy={fileActionBusy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void applyDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.files.deleteBody(removeTarget === null ? "" : baseName(removeTarget.path))}
        </p>
        <FileActionVersionNote target={removeTarget} />
      </ConfirmModal>
      {/* Write-precondition conflict: the file changed after the editor opened it, so the
          save was refused with nothing written. Cancel keeps the draft and the editor. */}
      <ConfirmModal
        open={conflict !== null}
        title={S.files.conflictTitle}
        tone="primary"
        confirmLabel={S.files.overwriteAnyway}
        cancelLabel={S.common.cancel}
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
        cancelLabel={S.common.cancel}
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
