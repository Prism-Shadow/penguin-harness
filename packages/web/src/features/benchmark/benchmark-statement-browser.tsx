import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BenchmarkCaseSummary,
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
} from "@prismshadow/penguin-server/api";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes, formatScore } from "../../lib/format";
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
  maxScore?: number;
}

function extOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : name.toLowerCase();
}

function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
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

export function BenchmarkStatementBrowser({
  projectId,
  agentId,
  benchmarkId,
  caseSummary,
  maxScore,
}: Props) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<WorkspaceFilesResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const initialReadmeOpened = useRef(false);
  const previewRequest = useRef(0);

  const fileUrl = useCallback(
    (filePath: string, options?: { download?: boolean; preview?: boolean }) =>
      api.benchmarkCaseFileUrl(projectId, agentId, benchmarkId, caseSummary.id, filePath, options),
    [projectId, agentId, benchmarkId, caseSummary.id],
  );

  const previewPath = useCallback(
    async (filePath: string) => {
      const request = ++previewRequest.current;
      const name = filePath.includes("/")
        ? filePath.slice(filePath.lastIndexOf("/") + 1)
        : filePath;
      const ext = extOf(name);
      if (IMAGE_EXTS.has(ext)) {
        setPreview({ path: filePath, name, kind: "image" });
        return;
      }
      if (ext === "pdf") {
        setPreview({ path: filePath, name, kind: "pdf" });
        return;
      }
      const isMarkdown = ext === "md";
      if (!TEXT_EXTS.has(ext)) {
        setPreview({ path: filePath, name, kind: "unsupported" });
        return;
      }
      setPreview({ path: filePath, name, kind: isMarkdown ? "md" : "text", loading: true });
      try {
        const response = await fetch(fileUrl(filePath, { preview: true }), {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(String(response.status));
        const content = await response.text();
        if (request !== previewRequest.current) return;
        setPreview({
          path: filePath,
          name,
          kind: isMarkdown ? "md" : "text",
          content,
          truncated: response.headers.get("x-content-truncated") === "1",
        });
      } catch (error) {
        if (request !== previewRequest.current) return;
        setPreview({
          path: filePath,
          name,
          kind: isMarkdown ? "md" : "text",
          error: apiErrorText(error),
        });
      }
    },
    [fileUrl],
  );

  useEffect(() => {
    setListing(null);
    setListError(null);
    let cancelled = false;
    api
      .listBenchmarkCaseFiles(projectId, agentId, benchmarkId, caseSummary.id, path)
      .then((data) => {
        if (cancelled) return;
        setListing(data);
        if (path === "" && !initialReadmeOpened.current) {
          initialReadmeOpened.current = true;
          const readme = data.entries.find(
            (entry) => entry.kind === "file" && entry.name.toLowerCase() === "readme.md",
          );
          if (readme) void previewPath(readme.name);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setListError(apiErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, benchmarkId, caseSummary.id, path, previewPath]);

  const crumbs = path === "" ? [] : path.split("/");
  const downloadUrl = preview ? fileUrl(preview.path, { download: true }) : null;

  const openEntry = (entry: WorkspaceFileEntry) => {
    if (entry.kind === "dir") {
      setPath(joinPath(path, entry.name));
      return;
    }
    void previewPath(joinPath(path, entry.name));
  };

  const markdownComponents: Components = {
    img: ({ src, alt }) => (
      <img
        src={
          typeof src === "string" && !EXTERNAL_REF_RE.test(src)
            ? fileUrl(resolveRelative(dirOf(preview?.path ?? ""), src))
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
      return (
        <a
          href={fileUrl(target)}
          onClick={(event) => {
            event.preventDefault();
            void previewPath(target);
          }}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className="grid min-h-[58vh] overflow-hidden rounded-md border border-gray-200 md:grid-cols-[240px_minmax(0,1fr)] dark:border-gray-800">
      <aside className="border-b border-gray-200 bg-gray-50/60 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-950/30">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-2 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setPath("")}
            className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {S.benchmark.publicMaterials}
          </button>
          {crumbs.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
              <span className="text-gray-300 dark:text-gray-700">/</span>
              <button
                type="button"
                onClick={() => setPath(crumbs.slice(0, index + 1).join("/"))}
                className="max-w-24 truncate rounded px-1 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
        <div className="max-h-44 overflow-y-auto md:max-h-[53vh]">
          {listError && <p className="px-3 py-2 text-xs text-red-500">{listError}</p>}
          {!listing && !listError && <SkeletonList rows={4} />}
          {listing?.entries.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">{S.files.empty}</p>
          )}
          {listing?.entries.map((entry) => (
            <button
              key={`${entry.kind}/${entry.name}`}
              type="button"
              onClick={() => openEntry(entry)}
              className="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-100 dark:border-gray-800/70 dark:hover:bg-gray-800/60"
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
      </aside>

      <section className="min-w-0">
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-gray-500">
              {preview?.path ?? caseSummary.id}
            </p>
          </div>
          {maxScore !== undefined && (
            <span className="shrink-0 text-xs text-gray-400">
              {S.benchmark.maxScore(formatScore(maxScore))}
            </span>
          )}
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
            <p className="text-sm text-gray-400">{S.benchmark.statementUnavailable}</p>
          ) : preview.loading ? (
            <SkeletonList rows={8} />
          ) : preview.error ? (
            <p className="text-sm text-red-500">{preview.error}</p>
          ) : preview.kind === "image" ? (
            <img
              src={fileUrl(preview.path)}
              alt={preview.name}
              loading="lazy"
              className="max-w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "pdf" ? (
            <iframe
              src={fileUrl(preview.path)}
              title={preview.name}
              className="h-[50vh] w-full rounded-md border border-gray-200 dark:border-gray-800"
            />
          ) : preview.kind === "md" ? (
            <>
              <div className="md-body text-sm text-gray-800 dark:text-gray-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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
