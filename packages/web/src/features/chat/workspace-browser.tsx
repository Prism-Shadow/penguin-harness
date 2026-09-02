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
 * The tree can be hidden (toolbar toggle, shown by default, one preference in localStorage).
 * The panel's width is the dock's, which may be far narrower than the viewport, so the
 * layout follows a measured width rather than a viewport breakpoint: below
 * TREE_LAYOUT_MIN_WIDTH the panes stop sharing the row and the tree and the preview show
 * one at a time — selecting a file replaces the tree, Back returns to it. Path scoping is
 * the server's job (including creating missing parent directories inside the sandbox).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent as ReactDragEvent } from "react";
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
  TEXT_PREVIEW_LIMIT,
  WORKSPACE_UPLOAD_LIMIT_MB,
  ancestorDirs,
  baseName,
  canEditPreview,
  dropTargetDir,
  expandTo,
  extOf,
  flattenTree,
  isDirty,
  isNarrowLayout,
  looksLikeText,
  needsDiscardConfirm,
  parentDir,
  previewKindFor,
  readTreeVisible,
  treePaneWidth,
  upsertEntry,
  utf8Complete,
  withExpanded,
  writeTreeVisible,
} from "../../lib/workspace-tree";
import type { EditorState, Listings } from "../../lib/workspace-tree";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { setCloseGuard } from "../dock/close-guard";
import { tabKey } from "../dock/dock-state";
import { PAPERCLIP_ICON } from "./attached-files-banner";
import { CodeBlock } from "./code-block";
import { languageForExtension } from "./code-languages";
import { WorkspaceFileEditor } from "./workspace-editor";
import { WorkspaceTreeView } from "./workspace-tree-view";

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
 * on every keystroke. The dock unmounts a panel's body on paths no confirm dialog can
 * intercept — a tab dragged to the other edge, a Session switched from the sidebar — so the
 * draft outlives the component: opening the same file again reopens the editor on it.
 */
const unsavedDrafts = new Map<string, string>();
const draftKey = (sessionId: string, path: string): string => `${sessionId}\n${path}`;

/**
 * Reads a file as text, bounded to TEXT_PREVIEW_LIMIT bytes: the body is read as a stream
 * and cancelled past the cap, so a large log never downloads whole for a preview. With
 * `sniff`, the first chunk decides whether the file is text at all — null means it is not,
 * and nothing more of it is read.
 */
async function fetchTextPreview(
  url: string,
  sniff: boolean,
): Promise<{ content: string; truncated: boolean } | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (reader === undefined) {
    const whole = new Uint8Array(await res.arrayBuffer());
    chunks.push(whole);
    total = whole.length;
  } else {
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
  }
  if (sniff && chunks.length > 0 && !looksLikeText(chunks[0]!.subarray(0, SNIFF_BYTES))) {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const truncated = total > TEXT_PREVIEW_LIMIT;
  const shown = truncated ? utf8Complete(bytes.subarray(0, TEXT_PREVIEW_LIMIT)) : bytes;
  return { content: new TextDecoder().decode(shown), truncated };
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

/** The tree row under a pointer, read off the row's data attributes. */
function hitRow(target: EventTarget | null): { kind: "dir" | "file"; path: string } | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>("[data-tree-path]");
  if (row === null) return null;
  const kind = row.dataset.treeKind;
  const path = row.dataset.treePath;
  return (kind === "dir" || kind === "file") && path !== undefined ? { kind, path } : null;
}

const ghostActionClass =
  "inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

export function WorkspaceBrowser({
  session,
  openRequest,
  active,
  reloadSignal,
}: {
  session: SessionInfo;
  /** External navigation command (from clicking a file chip in a message): opens the tree
   *  down to that path and previews it. Triggers again whenever the object reference changes,
   *  even if path is the same as last time (clicking the same file again must still re-locate it). */
  openRequest?: { path: string } | null;
  /** Whether the panel is visible: when collapsed in the docked state, the component stays
   *  mounted (width 0), during which the tree can go stale as the Agent writes files; a refresh
   *  is issued right at the moment it transitions from hidden to visible. */
  active?: boolean;
  /**
   * Bumped by the parent every time a Task settles on this session: the turn that just ended
   * is exactly when the Agent's writes land, so the tree — and whatever file is open in
   * the preview — is stale the moment it does. Any change of the number means "re-read",
   * so the initial value is irrelevant and no edge tracking is needed.
   */
  reloadSignal?: number;
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
  const [showPath, setShowPath] = useState(false);
  const [treeVisible, setTreeVisible] = useState(() => readTreeVisible());
  const [width, setWidth] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
    setPreview(null);
    setSourceError(null);
    setEditor(null);
    setSaveConfirm(false);
    setDiscardPrompt(null);
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
        const { content, truncated } = result;
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
            setEditor({ path: filePath, baseline: content, draft: stashed });
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
            ? { ...p, content: result.content, truncated: result.truncated }
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
  // the first run (the mount already read it), while no preview is open, and while that file
  // is being edited — re-reading it would put the Agent's text under the user's. Reading the
  // path from a ref keeps this effect keyed on the signal alone.
  const lastReloadSignal = useRef(reloadSignal);
  useEffect(() => {
    if (reloadSignal === lastReloadSignal.current) return;
    lastReloadSignal.current = reloadSignal;
    refreshAll();
    const open = previewRef.current?.path ?? null;
    if (open !== null && editorRef.current?.path !== open)
      void previewPath(open, { refresh: true });
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
  // browser shows is its own), and the dock's close guard for the tab's ×, the dock's hide
  // × and the toolbar's dock toggle, which unmount this body once the dock has collapsed.
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
      if (open && !listingsRef.current.has(dir)) void loadDir(dir);
    },
    [loadDir],
  );

  /** A breadcrumb: makes that directory current and brings it on screen; in the narrow layout that means leaving the preview for the tree. */
  const goToDir = (dir: string): void => {
    const land = () => {
      setCurrentDir(dir);
      setExpanded((s) => withExpanded(s, dir, true));
      if (dir !== "" && !listingsRef.current.has(dir)) void loadDir(dir);
      setScrollTo({ path: dir });
    };
    if (narrow && selectedPath !== null) {
      void navigateGuarded(null, () => {
        setSelectedPath(null);
        setPreview(null);
        land();
      });
    } else {
      land();
    }
  };

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

  // ----------------------------------------------------------------------------- editing

  const startEdit = async (): Promise<void> => {
    const current = previewRef.current;
    if (current === null || !canEditPreview(current)) return;
    let content = current.content;
    // An isolated HTML preview mounted without its text: read it now, and refuse a file the
    // bounded read cannot hold whole — saving a partial text back would truncate the file.
    if (content === undefined) {
      try {
        const result = await fetchTextPreview(api.workspaceFileUrl(sessionId, current.path), false);
        if (result === null || result.truncated) {
          toastError(S.files.editTooLarge(TEXT_PREVIEW_LIMIT / 1024));
          return;
        }
        content = result.content;
        const loaded = content;
        setPreview((p) =>
          p !== null && p.path === current.path ? { ...p, content: loaded, truncated: false } : p,
        );
      } catch {
        toastError(S.files.loadFailed);
        return;
      }
    }
    if (previewRef.current?.path !== current.path) return;
    setEditor({ path: current.path, baseline: content, draft: content });
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
    setSaveConfirm(true);
  };

  const save = async (): Promise<void> => {
    setSaveConfirm(false);
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
      await api.uploadWorkspaceFile(sid, current.path, await blobToBase64(blob));
      if (sessionIdRef.current !== sid) return;
      unsavedDrafts.delete(draftKey(sid, current.path));
      setEditor(null);
      // The preview now shows what was written; a fresh nonce remounts an HTML iframe onto it.
      const nonce = ++previewSeq;
      setPreview((p) =>
        p !== null && p.path === current.path
          ? { ...p, content: current.draft, truncated: false, nonce }
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
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void stageUpload(files, targetDir);
  };

  // ------------------------------------------------------------------------------ render

  const rows = useMemo(() => flattenTree(listings, expanded), [listings, expanded]);
  const rootListing = listings.get("");
  const crumbs = currentDir === "" ? [] : currentDir.split("/");
  const showTree = narrow ? selectedPath === null : treeVisible;
  const showPreview = narrow ? selectedPath !== null : true;
  const canEdit = preview !== null && editor === null && canEditPreview(preview);
  const dirLabel = (dir: string): string => (dir === "" ? S.files.root : dir);

  const tree = (
    <div
      className={`flex min-h-0 flex-col ${narrow ? "flex-1" : "shrink-0 border-r border-gray-200 dark:border-gray-800"}`}
      style={narrow ? undefined : { width: treePaneWidth(width) }}
    >
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
          onToggleDir={toggleDir}
          onOpenFile={openFile}
        />
      )}
    </div>
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
            onChange={updateDraft}
            onSave={requestSave}
          />
        </div>
      );
    }
    return (
      // scrollbar-gutter: an SVG carries no pixel size, so its height is whatever its width
      // divides to — which makes the content height a function of the scrollbar's presence.
      // Without a reserved gutter that closes a loop: content overflows -> scrollbar takes
      // width -> the image shrinks -> content fits -> scrollbar goes -> repeat, forever, as
      // a visible shake. Reserving it always breaks the feedback path (and is inert where
      // scrollbars are overlays).
      <div className="min-h-0 flex-1 overflow-auto p-3 [scrollbar-gutter:stable]">
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
            // The source view reuses the message stream's CodeBlock: Shiki dual-theme
            // highlighting + language label + copy button, no line wrapping, horizontal scroll
            // instead (wrapping code is a disaster for readability, see the old mobile styling).
            <>
              <CodeBlock
                language={languageForExtension(extOf(p.name))}
                code={p.content}
                highlight={p.content.length <= HIGHLIGHT_LIMIT}
              />
              {p.truncated && (
                <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
              )}
            </>
          )
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">{S.files.previewUnsupported}</p>
        )}
      </div>
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
                {dirty && (
                  <span className={`shrink-0 text-xs ${toneInk.attention}`}>{S.files.unsaved}</span>
                )}
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
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void startEdit()}
                    className={ghostActionClass}
                  >
                    {S.common.edit}
                  </button>
                )}
                {/* rel="noopener noreferrer" is load-bearing, not boilerplate: the preview must
                    not keep a handle back to this window, which is the whole point of serving
                    it from a separate origin. */}
                {/\.html?$/i.test(preview.name) && (
                  <a
                    href={api.workspaceFilePreviewUrl(sessionId, preview.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={previewIsolated ? undefined : S.files.previewNotIsolatedHint}
                    className={ghostActionClass}
                  >
                    {S.files.openInNewTab}
                    {!previewIsolated && (
                      <span
                        aria-label={S.files.previewNotIsolatedHint}
                        className={toneInk.attention}
                      >
                        ⚠
                      </span>
                    )}
                  </a>
                )}
                <a
                  href={api.workspaceFileUrl(sessionId, preview.path, true)}
                  download={preview.name}
                  className={ghostActionClass}
                >
                  {S.files.download}
                </a>
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
      {/* Toolbar: tree toggle + breadcrumbs of the current directory + actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
        {!narrow && (
          <button
            type="button"
            aria-pressed={treeVisible}
            title={treeVisible ? S.files.hideTree : S.files.showTree}
            aria-label={treeVisible ? S.files.hideTree : S.files.showTree}
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
        <button
          type="button"
          onClick={() => goToDir("")}
          className="rounded px-1.5 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {S.files.root}
        </button>
        {crumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-300 dark:text-gray-700">/</span>
            <button
              type="button"
              onClick={() => goToDir(crumbs.slice(0, i + 1).join("/"))}
              className="max-w-32 truncate rounded px-1 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {seg}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        {/* Details: a popup card showing the full absolute Workspace path (break-all wraps in full, never truncated). */}
        <Dropdown
          open={showPath}
          setOpen={setShowPath}
          menuClass="right-0 top-full mt-1 w-max max-w-72 origin-top-right"
          button={
            <Button
              size="sm"
              variant={showPath ? "primary" : "ghost"}
              onClick={() => setShowPath((v) => !v)}
            >
              {S.files.details}
            </Button>
          }
        >
          <div className="px-3.5 py-2.5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.files.workspacePath}
            </p>
            <p className="mt-1 break-all font-mono text-xs leading-5">{session.workspace}</p>
          </div>
        </Dropdown>
        <Button size="sm" variant="ghost" onClick={refreshAll}>
          {S.files.refresh}
        </Button>
        {/* Matches the same visual style and font size (sm = text-xs) as the adjacent ghost Buttons (Details/Refresh): no border, light background on hover. */}
        <label className="inline-flex cursor-pointer items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 focus-within:ring-2 focus-within:ring-gray-400/30 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <HiddenFileInput multiple onChange={onPick} disabled={uploading !== null} />
          {uploading !== null ? S.files.uploading(uploading.done, uploading.total) : S.files.upload}
        </label>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {showTree && tree}
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
