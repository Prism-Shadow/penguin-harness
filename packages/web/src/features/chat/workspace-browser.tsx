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
import remarkGfm from "remark-gfm";
import type { SessionInfo, WorkspaceFilesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { useAuth } from "../../state/auth";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes, formatDateTime } from "../../lib/format";
import { Button } from "../../components/ui/button";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Dropdown } from "../../components/ui/dropdown";
import { SkeletonList } from "../../components/ui/skeleton";
import { CodeBlock } from "./code-block";

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

/** Extension -> Shiki language id; extensions not listed are highlighted as "text" (plain text
 *  with the theme's background color); an id Shiki doesn't recognize is caught by CodeBlock and falls back to an unhighlighted <pre>. */
const SHIKI_LANG_BY_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  md: "markdown",
  py: "python",
  rb: "ruby",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  sh: "shellscript",
  bash: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  xml: "xml",
  sql: "sql",
  log: "log",
};

function langForExt(ext: string): string {
  return SHIKI_LANG_BY_EXT[ext] ?? "text";
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : name.toLowerCase();
}

function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
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
}

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
  // Whether "open in new tab" lands on a separate origin; false downgrades it to the
  // same-origin sandbox, which the link flags rather than failing silently in the page.
  const { previewIsolated } = useAuth();
  const [path, setPath] = useState("");
  const [data, setData] = useState<WorkspaceFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [showPath, setShowPath] = useState(false);
  /** HTML / Markdown preview: rendered view (HTML via sandboxed iframe, Markdown via md-body) / source toggle. */
  const [richView, setRichView] = useState<"rendered" | "source">("rendered");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listWorkspaceFiles(session.sessionId, path)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : S.files.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId, path, reloadTick]);

  // Returns to the root directory and clears the preview when the Session changes.
  useEffect(() => {
    setPath("");
    setPreview(null);
    setData(null);
  }, [session.sessionId]);

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
      setRichView("rendered");
      if (IMAGE_EXTS.has(ext)) {
        setPreview({ path: filePath, name, kind: "image" });
        return;
      }
      // PDF: the server returns it inline as application/pdf, embedded directly in an iframe and rendered by the browser.
      if (ext === "pdf") {
        setPreview({ path: filePath, name, kind: "pdf" });
        return;
      }
      const isHtml = HTML_EXTS.has(ext);
      const isMd = ext === "md";
      if (!isHtml && !TEXT_EXTS.has(ext)) {
        setPreview({ path: filePath, name, kind: "unsupported" });
        return;
      }
      try {
        // The server downgrades html/svg served inline to text/plain (a same-origin XSS
        // defense); this fetches the raw content back, and the HTML rendered view is placed in a
        // sandboxed iframe (without allow-scripts), so scripts don't execute.
        const res = await fetch(api.workspaceFileUrl(session.sessionId, filePath), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        const truncated = full.length > TEXT_PREVIEW_LIMIT;
        // Oversized Markdown defaults to the source view (benefiting from the unhighlighted
        // highlight=false path): feeding the whole block to remark for parsing is a one-time
        // main-thread cost; the user can still manually switch to "rendered view" as an informed choice.
        if (isMd && full.length > HIGHLIGHT_LIMIT) setRichView("source");
        setPreview({
          path: filePath,
          name,
          kind: isHtml ? "html" : isMd ? "md" : "text",
          content: truncated ? full.slice(0, TEXT_PREVIEW_LIMIT) : full,
          truncated,
        });
      } catch {
        setPreview({ path: filePath, name, kind: "unsupported" });
      }
    },
    [session.sessionId],
  );

  // External navigation command (clicking a file chip in a message / a file card): navigates to
  // the directory and previews the target path. Also refreshes the list: the target is most
  // likely a file the Agent just wrote, so the cached list is very likely stale; and when it's
  // the same directory, setPath is a same-value no-op that won't trigger the fetch effect, so it must be explicitly bumped.
  useEffect(() => {
    if (!openRequest) return;
    const target = openRequest.path;
    const dir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "";
    setPath(dir);
    setReloadTick((t) => t + 1);
    void previewPath(target);
  }, [openRequest, previewPath]);

  const openEntry = (name: string) => {
    void previewPath(joinPath(path, name));
  };

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
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
          await api.uploadWorkspaceFile(session.sessionId, joinPath(path, file.name), b64);
        }
        toastSuccess(S.files.uploaded);
        setReloadTick((t) => t + 1);
      } catch (err) {
        toastError(apiErrorText(err));
      } finally {
        setUploading(false);
      }
    })();
    e.target.value = "";
  };

  const crumbs = path === "" ? [] : path.split("/");

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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
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
                <span
                  aria-label={S.files.previewNotIsolatedHint}
                  className="text-amber-600 dark:text-amber-500"
                >
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
            // sandbox allows scripts but **without allow-same-origin**: the iframe has an opaque
            // origin, so scripts can run to fully render the page, yet can't read the app's
            // same-origin cookies / DOM (an XSS defense). The storage shim is injected to avoid
            // a SecurityError when a script accesses localStorage from an opaque origin.
            <iframe
              srcDoc={withStorageShim(preview.content ?? "")}
              title={preview.name}
              sandbox="allow-scripts"
              className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
            />
          ) : preview.kind === "md" && richView === "rendered" ? (
            // Markdown's default rendered view: uses the same md-body layout as message bodies
            // (ReactMarkdown outputs pure static HTML with no script execution surface, so no iframe sandbox is needed).
            <>
              <div className="md-body text-base leading-relaxed text-gray-800 dark:text-gray-100">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
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
            // The source view reuses the message stream's CodeBlock: Shiki dual-theme
            // highlighting + language label + copy button, no line wrapping, horizontal scroll
            // instead (wrapping code is a disaster for readability, see the old mobile styling).
            <>
              <CodeBlock
                language={langForExt(extOf(preview.name))}
                code={preview.content ?? ""}
                highlight={(preview.content?.length ?? 0) <= HIGHLIGHT_LIMIT}
              />
              {preview.truncated && (
                <p className="mt-1 text-xs text-gray-400">… {S.files.previewTruncated}</p>
              )}
            </>
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
          onClick={() => {
            setPath("");
          }}
          className="rounded px-1.5 py-0.5 text-sm text-gray-600 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {S.files.root}
        </button>
        {crumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-gray-300 dark:text-gray-700">/</span>
            <button
              type="button"
              onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
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
        <Button size="sm" variant="ghost" onClick={() => setReloadTick((t) => t + 1)}>
          {S.files.refresh}
        </Button>
        {/* Matches the same visual style and font size (sm = text-xs) as the adjacent ghost Buttons (Details/Refresh): no border, light background on hover. */}
        <label className="inline-flex cursor-pointer items-center rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 focus-within:ring-2 focus-within:ring-gray-400/30 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          {/* sr-only rather than hidden: keyboard users can still Tab-focus it (display:none would remove it from the focus order). */}
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={onUpload}
            disabled={uploading}
          />
          {uploading ? S.common.saving : S.files.upload}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : data === null ? (
          <SkeletonList rows={6} />
        ) : data.entries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-400">{S.files.empty}</p>
        ) : (
          // No "up a level" row: going up a level is done via the toolbar breadcrumbs (root / any segment is clickable).
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {data.entries.map((entry) => (
              <li key={entry.name}>
                <div className="group flex items-center gap-2 px-3 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <button
                    type="button"
                    onClick={() =>
                      entry.kind === "dir"
                        ? setPath(joinPath(path, entry.name))
                        : openEntry(entry.name)
                    }
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
                        joinPath(path, entry.name),
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
    </div>
  );
}
