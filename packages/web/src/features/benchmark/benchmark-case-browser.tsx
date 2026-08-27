import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BenchmarkCaseSummary,
  CaseMaterial,
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
} from "@prismshadow/penguin-server/api";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { joinWorkspacePath } from "../../lib/file-path";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";
import { SkeletonList } from "../../components/ui/skeleton";
import { CodeBlock } from "../chat/code-block";

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
  "sql",
  "svg",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const EXTERNAL_REF_RE = /^[a-z][a-z0-9+.-]*:/i;
const HIGHLIGHT_LIMIT = 64 * 1024;

interface Preview {
  material: CaseMaterial;
  path: string;
  name: string;
  kind: "text" | "md" | "image" | "pdf" | "unsupported";
  content?: string;
  truncated?: boolean;
  loading?: boolean;
  error?: string;
}

interface Props {
  projectId: string;
  agentId: string;
  benchmarkId: string;
  caseSummary: BenchmarkCaseSummary;
}

interface MaterialGroupProps extends Props {
  material: CaseMaterial;
  label: string;
  hiddenLabel?: string;
  defaultOpen?: boolean;
  /** Auto-preview this group's root readme.md on first load. Exactly one group (the statement)
   *  may carry it: both groups now open by default, and two racing auto-previews would leave the
   *  preview pane on whichever listing happened to resolve last. */
  autoPreviewReadme?: boolean;
  onPreview: (material: CaseMaterial, path: string) => void;
}

function extOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : name.toLowerCase();
}

function dirOf(filePath: string): string {
  return filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
}

function resolveRelative(baseDir: string, ref: string): string {
  const out = ref.startsWith("/") || baseDir === "" ? [] : baseDir.split("/");
  for (const segment of ref.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function languageFor(name: string): string {
  const ext = extOf(name);
  return (
    {
      json: "json",
      md: "markdown",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "jsx",
      ts: "typescript",
      tsx: "tsx",
      py: "python",
      sh: "shellscript",
      bash: "shellscript",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      css: "css",
      html: "html",
      htm: "html",
      xml: "xml",
      sql: "sql",
      svg: "xml",
    }[ext] ?? "text"
  );
}

function MaterialGroup({
  projectId,
  agentId,
  benchmarkId,
  caseSummary,
  material,
  label,
  hiddenLabel,
  defaultOpen = false,
  autoPreviewReadme = false,
  onPreview,
}: MaterialGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [path, setPath] = useState("");
  /** Bound to the path it was fetched for: entry targets join against `base`, so a click on a
   *  row that is momentarily stale (the fetch effect nulls the listing, but the state update
   *  commits one frame later) cannot compound segments onto an already-advanced `path`. */
  const [listing, setListing] = useState<{ base: string; res: WorkspaceFilesResponse } | null>(
    null,
  );
  const [listError, setListError] = useState<string | null>(null);
  const initialReadmeOpened = useRef(false);

  useEffect(() => {
    if (!open) return;
    setListing(null);
    setListError(null);
    let cancelled = false;
    api
      .listBenchmarkCaseFiles(projectId, agentId, benchmarkId, caseSummary.id, path, material)
      .then((data) => {
        if (cancelled) return;
        setListing({ base: path, res: data });
        if (autoPreviewReadme && path === "" && !initialReadmeOpened.current) {
          initialReadmeOpened.current = true;
          const readme = data.entries.find(
            (entry) => entry.kind === "file" && entry.name.toLowerCase() === "readme.md",
          );
          if (readme) onPreview(material, readme.name);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setListError(apiErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    agentId,
    benchmarkId,
    caseSummary.id,
    material,
    autoPreviewReadme,
    onPreview,
    open,
    path,
  ]);

  const crumbs = path === "" ? [] : path.split("/");

  const openEntry = (entry: WorkspaceFileEntry) => {
    if (listing === null) return; // rows only render out of a loaded listing
    const target = joinWorkspacePath(listing.base, entry.name);
    if (entry.kind === "dir") {
      setPath(target);
      return;
    }
    onPreview(material, target);
  };

  return (
    <div className="border-b border-gray-200 last:border-b-0 dark:border-gray-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800/60"
      >
        <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
        {hiddenLabel && (
          <span className="shrink-0 rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {hiddenLabel}
          </span>
        )}
      </button>
      {open && (
        <div>
          {crumbs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 px-5 py-1.5 dark:border-gray-800/70">
              <button
                type="button"
                onClick={() => setPath("")}
                className="rounded px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {label}
              </button>
              {crumbs.map((segment, index) => (
                <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
                  <span className="text-gray-300 dark:text-gray-700">/</span>
                  <button
                    type="button"
                    onClick={() => setPath(crumbs.slice(0, index + 1).join("/"))}
                    className="max-w-24 truncate rounded px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {segment}
                  </button>
                </span>
              ))}
            </div>
          )}
          {listError && <p className="px-6 py-2 text-xs text-red-500">{listError}</p>}
          {!listing && !listError && <SkeletonList rows={3} />}
          {listing?.res.entries.length === 0 && (
            <p className="px-6 py-2 text-xs text-gray-400">{S.files.empty}</p>
          )}
          {listing?.res.entries.map((entry) => (
            <button
              key={`${entry.kind}/${entry.name}`}
              type="button"
              onClick={() => openEntry(entry)}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-6 py-2 text-left hover:bg-gray-100 dark:border-gray-800/70 dark:hover:bg-gray-800/60"
            >
              <span className="text-sm text-gray-400">{entry.kind === "dir" ? "▸" : "·"}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
              {entry.kind === "file" && (
                <span className="shrink-0 text-[11px] text-gray-400">
                  {formatBytes(entry.sizeBytes)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BenchmarkCaseBrowser({ projectId, agentId, benchmarkId, caseSummary }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRequest = useRef(0);

  const fileUrl = useCallback(
    (
      material: CaseMaterial,
      filePath: string,
      options?: { download?: boolean; preview?: boolean },
    ) =>
      api.benchmarkCaseFileUrl(
        projectId,
        agentId,
        benchmarkId,
        caseSummary.id,
        filePath,
        material,
        options,
      ),
    [projectId, agentId, benchmarkId, caseSummary.id],
  );

  const previewPath = useCallback(
    async (material: CaseMaterial, filePath: string) => {
      const request = ++previewRequest.current;
      const name = filePath.includes("/")
        ? filePath.slice(filePath.lastIndexOf("/") + 1)
        : filePath;
      const ext = extOf(name);
      if (IMAGE_EXTS.has(ext)) {
        setPreview({ material, path: filePath, name, kind: "image" });
        return;
      }
      if (ext === "pdf") {
        setPreview({ material, path: filePath, name, kind: "pdf" });
        return;
      }
      const isMarkdown = ext === "md";
      if (!TEXT_EXTS.has(ext)) {
        setPreview({ material, path: filePath, name, kind: "unsupported" });
        return;
      }
      setPreview({
        material,
        path: filePath,
        name,
        kind: isMarkdown ? "md" : "text",
        loading: true,
      });
      try {
        const response = await fetch(fileUrl(material, filePath, { preview: true }), {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(String(response.status));
        const content = await response.text();
        if (request !== previewRequest.current) return;
        setPreview({
          material,
          path: filePath,
          name,
          kind: isMarkdown ? "md" : "text",
          content,
          truncated: response.headers.get("x-content-truncated") === "1",
        });
      } catch (error) {
        if (request !== previewRequest.current) return;
        setPreview({
          material,
          path: filePath,
          name,
          kind: isMarkdown ? "md" : "text",
          error: apiErrorText(error),
        });
      }
    },
    [fileUrl],
  );

  const downloadUrl = preview ? fileUrl(preview.material, preview.path, { download: true }) : null;
  const previewMaterialLabel =
    preview?.material === "rubric" ? S.benchmark.rubric : S.benchmark.taskMaterials;

  const markdownComponents: Components = {
    img: ({ src, alt }) => (
      <img
        src={
          typeof src === "string" && !EXTERNAL_REF_RE.test(src)
            ? fileUrl(
                preview?.material ?? "statement",
                resolveRelative(dirOf(preview?.path ?? ""), src),
              )
            : src
        }
        alt={alt ?? ""}
        loading="lazy"
        className="max-w-full"
      />
    ),
    a: ({ href, children }) => {
      if (typeof href !== "string" || href.startsWith("#")) return <a href={href}>{children}</a>;
      if (EXTERNAL_REF_RE.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      const target = resolveRelative(dirOf(preview?.path ?? ""), href);
      const material = preview?.material ?? "statement";
      return (
        <a
          href={fileUrl(material, target)}
          onClick={(event) => {
            event.preventDefault();
            void previewPath(material, target);
          }}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className="grid min-h-[58vh] grid-cols-1 overflow-hidden rounded-md border border-gray-200 md:grid-cols-[240px_minmax(0,1fr)] dark:border-gray-800">
      <aside className="border-b border-gray-200 bg-gray-50/60 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-950/30">
        <div className="max-h-44 overflow-y-auto md:max-h-[53vh]">
          <MaterialGroup
            projectId={projectId}
            agentId={agentId}
            benchmarkId={benchmarkId}
            caseSummary={caseSummary}
            material="statement"
            label={S.benchmark.taskMaterials}
            defaultOpen
            autoPreviewReadme
            onPreview={previewPath}
          />
          <MaterialGroup
            projectId={projectId}
            agentId={agentId}
            benchmarkId={benchmarkId}
            caseSummary={caseSummary}
            material="rubric"
            label={S.benchmark.rubric}
            hiddenLabel={S.benchmark.agentHidden}
            defaultOpen
            onPreview={previewPath}
          />
        </div>
      </aside>

      <section className="min-w-0">
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-gray-500">
              {preview ? `${previewMaterialLabel} / ${preview.path}` : caseSummary.id}
            </p>
          </div>
          {downloadUrl && preview && (
            <a
              href={downloadUrl}
              download={preview.name}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {S.files.download}
            </a>
          )}
        </div>
        <div className="max-h-[52vh] min-h-[52vh] overflow-auto p-3">
          {!preview ? (
            <p className="text-sm text-gray-400">{S.benchmark.caseFileUnavailable}</p>
          ) : preview.loading ? (
            <SkeletonList rows={8} />
          ) : preview.error ? (
            <p className="text-sm text-red-500">{preview.error}</p>
          ) : preview.kind === "image" ? (
            <img
              src={fileUrl(preview.material, preview.path)}
              alt={preview.name}
              loading="lazy"
              className="max-w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "pdf" ? (
            <iframe
              src={fileUrl(preview.material, preview.path)}
              title={preview.name}
              className="h-[50vh] w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "md" ? (
            <>
              <div className="md-body text-sm text-gray-800 dark:text-gray-100">
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  rehypePlugins={REHYPE_PLUGINS}
                  components={markdownComponents}
                >
                  {preview.content ?? ""}
                </ReactMarkdown>
              </div>
              {preview.truncated && (
                <p className="mt-2 text-xs text-gray-400">{S.files.previewTruncated}</p>
              )}
            </>
          ) : preview.kind === "text" ? (
            <>
              <CodeBlock
                language={languageFor(preview.name)}
                code={preview.content ?? ""}
                highlight={(preview.content?.length ?? 0) <= HIGHLIGHT_LIMIT}
              />
              {preview.truncated && (
                <p className="mt-2 text-xs text-gray-400">{S.files.previewTruncated}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.files.previewUnsupported}</p>
          )}
        </div>
      </section>
    </div>
  );
}
