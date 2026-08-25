/**
 * Workspace file browser (the "Browse All" tab of the Files panel): directory navigation
 * (breadcrumbs, going up a level navigates via a breadcrumb segment), file list (name/size/
 * modified time), preview (Markdown/HTML default to a rendered view + a source toggle, text/
 * images shown inline, other types prompt a download), upload (multi-select in the current
 * directory, single file <=14MB) and download. Path scoping is validated by the server (including
 * auto-creating missing parent directories within the sandbox, an API-level capability).
 *
 * Single-column list <-> preview drill-down (no side-by-side layout): the panel's width is
 * controlled by the outer Files panel and may be much narrower than the viewport, so `lg:`-style
 * viewport breakpoints would misjudge things here (a wide viewport doesn't mean this component
 * got a wide allotment of space) — so the list and preview are shown mutually exclusively,
 * routed by whether the existing `preview` is null, without introducing extra state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { REMARK_PLUGINS } from "../../lib/remark-autolink-boundary";
import type { SessionInfo, WorkspaceFilesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { useAuth } from "../../state/auth";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { joinWorkspacePath } from "../../lib/file-path";
import { formatBytes, formatDateTime } from "../../lib/format";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Dropdown } from "../../components/ui/dropdown";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { SkeletonList } from "../../components/ui/skeleton";
import { CodeBlock } from "./code-block";
import { languageForExtension } from "./code-languages";
import { toneInk } from "../../lib/tone";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";

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
  "html",
  "htm",
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
/** Read cap for text preview (beyond this, truncated with a download prompt). */
const TEXT_PREVIEW_LIMIT = 256 * 1024;
/** Source highlighting cap: tokenizing the full 256KB preview cap's worth of content in one go would block the main thread, so beyond this it falls back to unhighlighted. */
const HIGHLIGHT_LIMIT = 64 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : name.toLowerCase();
}

function dirOf(filePath: string): string {
  return filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
}

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
 *  docked panel and the drawer never mount WorkspaceBrowser at the same time. */
let previewSeq = 0;

export function WorkspaceBrowser({
  session,
  openRequest,
  active,
  onPreviewOpen,
}: {
  session: SessionInfo;
  /** External navigation command (from clicking a file chip in a message): navigates to the
   *  directory and previews that path. Triggers again whenever the object reference changes,
   *  even if path is the same as last time (clicking the same file again must still re-locate it). */
  openRequest?: { path: string } | null;
  /** Whether the panel is visible: when collapsed in the docked state, the component stays
   *  mounted (width 0), during which the list can go stale as the Agent writes files; a refresh
   *  is issued right at the moment it transitions from hidden to visible. */
  active?: boolean;
  /** Callback when entering file preview (used by the mobile Sheet to raise its snap point to full). */
  onPreviewOpen?: () => void;
}) {
  // Whether the HTML preview lands on a separate origin. True routes both the in-app
  // rendered view and "open in new tab" through the preview origin; false downgrades
  // the new tab to the same-origin sandbox (which the link flags rather than failing
  // silently in the page) and the in-app rendered view to the srcDoc fallback.
  const { previewIsolated } = useAuth();
  const [path, setPath] = useState("");
  /**
   * The loaded listing, bound to the path it was fetched for. Entry-row targets (descend /
   * preview / download) are joined against `base` — the generation the rendered rows came
   * from — never against the live `path` state: the stale rows stay on screen while a
   * navigation fetch is in flight, and joining onto the already-advanced path would compound
   * segments on a double-click ("home" → "home/home", a directory that does not exist).
   * Base-bound targets make a repeated click recompute the same target, i.e. a no-op.
   */
  const [data, setData] = useState<{ base: string; res: WorkspaceFilesResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Picked files whose names collide with the loaded listing (non-null shows the overwrite confirm). */
  const [pendingUpload, setPendingUpload] = useState<{ files: File[]; clashes: string[] } | null>(
    null,
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [showPath, setShowPath] = useState(false);
  /** HTML / Markdown preview: rendered view (HTML via sandboxed iframe, Markdown via md-body) / source toggle. */
  const [richView, setRichView] = useState<"rendered" | "source">("rendered");
  /** Error from the lazy source fetch of an isolated HTML preview: scoped to the source
   *  view — the rendered iframe keeps working no matter what happens to this fetch. */
  const [sourceError, setSourceError] = useState<string | null>(null);
  /** Mirror for previewPath: reading previewIsolated through a ref keeps the callback's
   *  identity stable when /api/me refreshes it (previewPath drives the openRequest locate
   *  effect, which must not replay on an auth-context change). */
  const previewIsolatedRef = useRef(previewIsolated);
  previewIsolatedRef.current = previewIsolated;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listWorkspaceFiles(session.sessionId, path)
      .then((res) => {
        if (!cancelled) setData({ base: path, res });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : S.files.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId, path, reloadTick]);

  // Session switched: back to the root directory with no preview. Reset during render
  // (React's documented "adjust state when a prop changes" pattern), not in an effect —
  // an effect-based reset lets one frame commit in which the old session's preview
  // renders against the new session, flipping the isolated iframe's src to the new
  // session + the old path and firing a doomed request. Bumping previewSeq also
  // invalidates any in-flight previewPath from the old session (its present() guard
  // fails), so a late result can't resurrect old-session content after the reset.
  const [renderedSessionId, setRenderedSessionId] = useState(session.sessionId);
  if (renderedSessionId !== session.sessionId) {
    setRenderedSessionId(session.sessionId);
    setPath("");
    setPreview(null);
    setData(null);
    setSourceError(null);
    previewSeq++;
  }

  // Edge-triggered refresh on the panel's hidden -> visible transition (doesn't count the initial mount: mounting itself already fetches once).
  const prevActive = useRef(active);
  useEffect(() => {
    if (active && !prevActive.current) setReloadTick((t) => t + 1);
    prevActive.current = active;
  }, [active]);

  /** The preview callback goes through a ref: keeps previewPath's useCallback dependency stable,
   *  so even if the parent passes an inline arrow function, the openRequest locate effect doesn't
   *  replay just because previewPath's reference changed. */
  const onPreviewOpenRef = useRef(onPreviewOpen);
  onPreviewOpenRef.current = onPreviewOpen;

  const previewPath = useCallback(
    async (filePath: string) => {
      onPreviewOpenRef.current?.();
      const name = filePath.includes("/")
        ? filePath.slice(filePath.lastIndexOf("/") + 1)
        : filePath;
      const ext = extOf(name);
      const nonce = ++previewSeq;
      /** Publishes this call's result unless a newer previewPath call has started since:
       *  two rapid calls interleave across the await, and the late loser must not
       *  overwrite the winner's preview. */
      const present = (p: Preview) => {
        if (nonce === previewSeq) setPreview(p);
      };
      setRichView("rendered");
      setSourceError(null);
      if (IMAGE_EXTS.has(ext)) {
        present({ path: filePath, name, kind: "image", nonce });
        return;
      }
      // PDF: the server returns it inline as application/pdf, embedded directly in an iframe and rendered by the browser.
      if (ext === "pdf") {
        present({ path: filePath, name, kind: "pdf", nonce });
        return;
      }
      const isHtml = HTML_EXTS.has(ext);
      const isMd = ext === "md";
      if (!isHtml && !TEXT_EXTS.has(ext)) {
        present({ path: filePath, name, kind: "unsupported", nonce });
        return;
      }
      // Isolated HTML: the rendered view is an iframe onto the preview origin and needs no
      // text here, so the iframe mounts with no upfront fetch — a large file isn't
      // downloaded twice, and a transient fetch failure can't downgrade a page the iframe
      // would serve fine. The source text is fetched lazily on the first Source toggle
      // (see the effect below).
      if (isHtml && previewIsolatedRef.current) {
        present({ path: filePath, name, kind: "html", nonce });
        return;
      }
      try {
        // The server downgrades html/svg served inline to text/plain (a same-origin XSS
        // defense); this fetches the raw content back for text/Markdown previews and for
        // the srcDoc fallback rendered view of non-isolated HTML.
        const res = await fetch(api.workspaceFileUrl(session.sessionId, filePath), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        const truncated = full.length > TEXT_PREVIEW_LIMIT;
        // Oversized Markdown defaults to the source view (benefiting from the unhighlighted
        // highlight=false path): feeding the whole block to remark for parsing is a one-time
        // main-thread cost; the user can still manually switch to "rendered view" as an informed choice.
        if (isMd && full.length > HIGHLIGHT_LIMIT && nonce === previewSeq) setRichView("source");
        present({
          path: filePath,
          name,
          kind: isHtml ? "html" : isMd ? "md" : "text",
          content: truncated ? full.slice(0, TEXT_PREVIEW_LIMIT) : full,
          truncated,
          nonce,
        });
      } catch {
        present({ path: filePath, name, kind: "unsupported", nonce });
      }
    },
    [session.sessionId],
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
        const res = await fetch(api.workspaceFileUrl(session.sessionId, target), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        if (cancelled) return;
        const truncated = full.length > TEXT_PREVIEW_LIMIT;
        // Functional update with its own guard (not `present`): this must only fill the
        // still-current, still-contentless HTML preview for the same path, never revive
        // a preview the user has since navigated away from.
        setPreview((p) =>
          p !== null && p.kind === "html" && p.path === target && p.content === undefined
            ? { ...p, content: truncated ? full.slice(0, TEXT_PREVIEW_LIMIT) : full, truncated }
            : p,
        );
      } catch {
        if (!cancelled) setSourceError(S.files.loadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, richView, previewIsolated, session.sessionId]);

  // External navigation command (clicking a file chip in a message / a file card): navigates to
  // the directory and previews the target path. Also refreshes the list: the target is most
  // likely a file the Agent just wrote, so the cached list is very likely stale; and when it's
  // the same directory, setPath is a same-value no-op that won't trigger the fetch effect, so it must be explicitly bumped.
  //
  // Each openRequest object is handled exactly once (the ref guard): this effect also
  // re-runs when previewPath's identity changes with session.sessionId, at which point
  // openRequest is still the OLD session's request — the parent clears it only after
  // child effects. Replaying it against the new session would resurrect the preview the
  // session-switch reset just cleared, for isolated HTML as a committed iframe onto a
  // path the new Workspace doesn't have (a raw 404 page). browsePath creates a fresh
  // object per click, so re-clicking the same file still re-triggers.
  const handledOpenRequest = useRef<{ path: string } | null>(null);
  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    const target = openRequest.path;
    const dir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
    setPath(dir);
    setReloadTick((t) => t + 1);
    void previewPath(target);
  }, [openRequest, previewPath]);

  const doUpload = (files: File[]) => {
    setUploading(true);
    setError(null);
    void (async () => {
      try {
        for (const file of files) {
          const b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = reader.result as string;
              resolve(url.slice(url.indexOf(",") + 1)); // Strip the data:...;base64, prefix
            };
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(file);
          });
          await api.uploadWorkspaceFile(session.sessionId, joinWorkspacePath(path, file.name), b64);
        }
        toastSuccess(S.files.uploaded);
        setReloadTick((t) => t + 1);
      } catch (err) {
        toastError(apiErrorText(err));
      } finally {
        setUploading(false);
      }
    })();
  };

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (files.length === 0) return;
    // Uploads overwrite same-name files: names already present in the loaded listing
    // confirm first (the picker is stashed — confirm continues, cancel drops it).
    const existing = new Set((data?.res.entries ?? []).map((entry) => entry.name));
    const clashes = files.filter((f) => existing.has(f.name)).map((f) => f.name);
    if (clashes.length > 0) setPendingUpload({ files, clashes });
    else doUpload(files);
  };

  const crumbs = path === "" ? [] : path.split("/");
  /**
   * A navigation fetch is in flight: the rendered rows belong to a different directory than
   * the one being loaded. Entry rows and breadcrumbs are disabled for the duration — the
   * base-bound targets above are what make clicks safe regardless of timing; this is the
   * user-visible feedback. Derived, not stored: initial load and same-path refreshes
   * (reloadTick) don't count, and a failed navigation renders `error` instead of rows, so
   * the disabled state can never outlive the fetch that justified it.
   */
  const busy = error === null && data !== null && data.base !== path;

  if (preview !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* flex-wrap: the panel can be dragged down to a 320px minimum width, narrower than this
            row's uncompressible content (back + view toggle + download ~= 370px+); without
            wrapping, the panel's overflow-hidden would clip the right-side buttons off. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          <button
            type="button"
            onClick={() => {
              // Refreshes in passing when returning to the list: the Agent may have written new files during the preview.
              setPreview(null);
              setReloadTick((t) => t + 1);
            }}
            title={S.files.backToList}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <GlyphIcon d="M15 18l-6-6 6-6" size={ICON_SIZE.rowLead} />
            {S.files.backToList}
          </button>
          {/* Shows only the filename (full path goes into the title hover tooltip): the
              directory prefix and extension badge are both information the filename already
              carries, and on a narrow panel they'd just crowd out the title space. */}
          <span
            className="min-w-0 flex-1 truncate font-mono text-sm font-semibold"
            title={preview.path}
          >
            {preview.name}
          </span>
          {/* HTML / Markdown: rendered view / source toggle */}
          {(preview.kind === "html" || preview.kind === "md") && (
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
          )}
          {/* Ghost style, matching the toolbar's upload label (text-xs, transparent until hover) — the bordered secondary look stood out from every neighbor. */}
          {/* rel="noopener noreferrer" is load-bearing, not boilerplate: the preview must
              not keep a handle back to this window, which is the whole point of serving
              it from a separate origin. */}
          {/\.html?$/i.test(preview.name) && (
            <a
              href={api.workspaceFilePreviewUrl(session.sessionId, preview.path)}
              target="_blank"
              rel="noopener noreferrer"
              title={previewIsolated ? undefined : S.files.previewNotIsolatedHint}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              {S.files.openInNewTab}
              {!previewIsolated && (
                <span aria-label={S.files.previewNotIsolatedHint} className={toneInk.attention}>
                  ⚠
                </span>
              )}
            </a>
          )}
          <a
            href={api.workspaceFileUrl(session.sessionId, preview.path, true)}
            download={preview.name}
            className="inline-flex shrink-0 items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            {S.files.download}
          </a>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {preview.kind === "image" ? (
            <img
              src={api.workspaceFileUrl(session.sessionId, preview.path)}
              alt={preview.name}
              className="max-w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "pdf" ? (
            <iframe
              src={api.workspaceFileUrl(session.sessionId, preview.path)}
              title={preview.name}
              className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "html" && richView === "rendered" ? (
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
                key={preview.nonce}
                src={api.workspaceFilePreviewUrl(session.sessionId, preview.path)}
                title={preview.name}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
              />
            ) : preview.content === undefined ? (
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
                srcDoc={withStorageShim(preview.content)}
                title={preview.name}
                sandbox="allow-scripts"
                className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
              />
            )
          ) : preview.kind === "md" && richView === "rendered" ? (
            // Markdown's default rendered view: uses the same md-body layout as message bodies
            // (ReactMarkdown outputs pure static HTML with no script execution surface, so no iframe sandbox is needed).
            <>
              <div className="md-body text-base leading-relaxed text-gray-800 dark:text-gray-100">
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  components={{
                    // Relative images are resolved against the md file's directory into the file API (otherwise resolving against the app's origin would always 404).
                    img: ({ src, alt }) => (
                      <img
                        src={
                          typeof src === "string" && !EXTERNAL_REF_RE.test(src)
                            ? api.workspaceFileUrl(
                                session.sessionId,
                                resolveRelative(dirOf(preview.path), src),
                              )
                            : src
                        }
                        alt={alt ?? ""}
                        loading="lazy"
                        className="max-w-full"
                      />
                    ),
                    // External links open in a new tab; relative links point to a Workspace
                    // file, clicking switches the preview directly; in-page anchors keep default behavior.
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
                      const target = resolveRelative(dirOf(preview.path), href);
                      return (
                        <a
                          href={api.workspaceFileUrl(session.sessionId, target)}
                          onClick={(e) => {
                            e.preventDefault();
                            void previewPath(target);
                          }}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {preview.content ?? ""}
                </ReactMarkdown>
              </div>
              {preview.truncated && (
                <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
              )}
            </>
          ) : preview.kind === "text" || preview.kind === "html" || preview.kind === "md" ? (
            preview.content === undefined ? (
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
                  language={languageForExtension(extOf(preview.name))}
                  code={preview.content}
                  highlight={preview.content.length <= HIGHLIGHT_LIMIT}
                />
                {preview.truncated && (
                  <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
                )}
              </>
            )
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.files.previewUnsupported}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: breadcrumbs + actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPath("");
          }}
          className="rounded px-1.5 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {S.files.root}
        </button>
        {crumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-300 dark:text-gray-700">/</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
              className="max-w-32 truncate rounded px-1 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
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
        <Button size="sm" variant="ghost" onClick={() => setReloadTick((t) => t + 1)}>
          {S.files.refresh}
        </Button>
        {/* Matches the same visual style and font size (sm = text-xs) as the adjacent ghost Buttons (Details/Refresh): no border, light background on hover. */}
        <label className="inline-flex cursor-pointer items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 focus-within:ring-2 focus-within:ring-gray-400/30 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <HiddenFileInput multiple onChange={onUpload} disabled={uploading} />
          {uploading ? S.common.saving : S.files.upload}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : data === null ? (
          <SkeletonList rows={6} />
        ) : data.res.entries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-400">{S.files.empty}</p>
        ) : (
          // No "up a level" row: going up a level is done via the toolbar breadcrumbs (root / any segment is clickable).
          // While a navigation is in flight (busy) the stale rows stay visible but dimmed and inert.
          <ul
            aria-busy={busy}
            className={`divide-y divide-gray-100 dark:divide-gray-800/60 ${busy ? "opacity-60" : ""}`}
          >
            {data.res.entries.map((entry) => (
              <li key={entry.name}>
                <div className="group flex items-center gap-2 px-3 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // Joined against the listing's own base (see the data state comment): a second
                      // click on the same stale row resolves to the same target, not a deeper one.
                      const target = joinWorkspacePath(data.base, entry.name);
                      if (entry.kind === "dir") setPath(target);
                      else void previewPath(target);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={entry.name}
                  >
                    <span className="shrink-0 text-gray-400" aria-hidden>
                      {entry.kind === "dir" ? (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                        >
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                        >
                          <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                  </button>
                  <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
                    {entry.kind === "file" ? formatBytes(entry.sizeBytes) : ""}
                  </span>
                  <span className="hidden shrink-0 font-mono text-xs text-gray-400 sm:block dark:text-gray-500">
                    {entry.mtime ? formatDateTime(entry.mtime) : ""}
                  </span>
                  {entry.kind === "file" && (
                    <a
                      href={api.workspaceFileUrl(
                        session.sessionId,
                        joinWorkspacePath(data.base, entry.name),
                        true,
                      )}
                      download={entry.name}
                      title={S.files.download}
                      className="shrink-0 rounded p-1 text-gray-300 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 group-hover:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                      </svg>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upload-overwrite confirmation: same-name files in this directory get replaced. */}
      <ConfirmModal
        open={pendingUpload !== null}
        title={S.files.overwriteTitle}
        tone="primary"
        confirmLabel={S.files.upload}
        onClose={() => setPendingUpload(null)}
        onConfirm={() => {
          if (pendingUpload) doUpload(pendingUpload.files);
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
    </div>
  );
}
