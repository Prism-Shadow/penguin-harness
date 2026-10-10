/**
 * The read-only file browser: a `FileTree` in an aside on the left, one preview pane on the
 * right. The Web App's plugin detail Modal and its Benchmark case dialog are both this, so files
 * that cannot be edited are read the same way wherever they are met — the Workspace files panel
 * draws the same tree, with its own editing, HTML sandbox and selection machinery around it.
 *
 * What this owns is the layout and the preview: the two panes, their scroll caps, the header
 * line naming what is open with its Download link, and how each kind of file is drawn —
 * Markdown through the shared pipeline (`Md`), text through the code block, an image and a PDF
 * from their own URLs.
 *
 * What the host owns is where the files come from: how the rows are produced (the plugin
 * groups a listing it already holds, the case dialog lists one directory per level as it is
 * opened), how a preview's content is fetched, and what a relative Markdown reference points
 * at. A row's `path` is the only identifier here — it is what the tree highlights, what
 * `onOpenFile` hands back and what the header prints — so a host whose paths are not unique
 * on their own (the case dialog's two materials) prefixes them itself. The words are the host's
 * too: the four this draws on its own arrive as props.
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Components } from "react-markdown";
import { CodeBlock } from "../../content/code-block/code-block";
import { languageForFileName } from "../../content/code-block/code-languages";
import { bodyWithoutFrontmatter } from "../../content/prose/frontmatter";
import { Md } from "../../content/prose/prose";
import { SkeletonList } from "../../feedback/skeleton/skeleton";
import { FileTree } from "../file-tree/file-tree";
import type { TreeToggle } from "../file-tree/file-tree";
import type { FileTreeRow } from "../file-tree/tree-rows";

/** A reference naming a scheme of its own (`https:`, `mailto:`) points outside the browsed files. */
const EXTERNAL_REF_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Past this size, highlighting a text preview costs more than the colours are worth. */
const HIGHLIGHT_LIMIT = 64 * 1024;

/** Tree column width when the host names none, in px. */
const DEFAULT_TREE_WIDTH = 220;

/** Default pane heights on a wide screen, in vh: the tree's scroll cap, the preview's box. */
const DEFAULT_TREE_MAX_HEIGHT = 50;
const DEFAULT_PREVIEW_HEIGHT = 50;

/** How a read-only preview draws a file. */
export type FileBrowserPreviewKind = "text" | "md" | "image" | "pdf" | "unsupported";

/** The file in the preview pane, and everything it takes to draw it. */
export interface FileBrowserPreview {
  /** The tree row path of the previewed file (what `selectedPath` highlights). */
  path: string;
  name: string;
  kind: FileBrowserPreviewKind;
  /** text / md content once loaded. */
  content?: string;
  truncated?: boolean;
  loading?: boolean;
  error?: string;
  /** Where an image / pdf is served from; absent for in-memory text. */
  url?: string;
  /** A download link in the header when present. */
  downloadUrl?: string;
}

export interface FileBrowserProps<Row extends FileTreeRow> {
  rows: readonly Row[];
  /** The tree's accessible name. */
  treeLabel: string;
  selectedPath: string | null;
  /** Directories whose listing is in flight: the row dims and reports `aria-busy`. */
  loadingDirs?: ReadonlySet<string>;
  /** The directory last opened or closed, whose subtree animates. Null: nothing to animate. */
  toggled?: TreeToggle | null;
  /** Trailing content on a row, after its name — a file's size, a directory's badge. */
  rowTrailing?: (row: Row) => ReactNode;
  /** The listing is in flight: with no rows to draw, both panes wait with a skeleton. */
  treeLoading?: boolean;
  /** The listing failed: the aside says so, above whatever rows it does have. */
  treeError?: string | null;
  /** The header line while nothing is previewed: the plugin's name, the case's id. */
  headerFallback: string;
  /** What the header prints in place of the previewed row's own path. */
  headerPath?: string;
  preview: FileBrowserPreview | null;
  /** The preview body while nothing is selected. */
  emptyPreview: string;
  /** What an open directory holding nothing says in place of its children. */
  emptyDirLabel: string;
  /** The note under a preview that stopped short of the whole file. */
  truncatedLabel: string;
  /** The preview body for a file this browser cannot draw. */
  unsupportedLabel: string;
  /** The header's download link. */
  downloadLabel: string;
  /** Markdown: drop a leading frontmatter block before rendering. */
  stripFrontmatter?: boolean;
  /**
   * What a relative Markdown reference points at: the URL to load an image from, and the tree
   * path a link opens in place. Called only for a reference that is neither an in-page anchor
   * nor a scheme of its own; null leaves the reference as the file wrote it.
   */
  resolveRef?: (ref: string) => { url: string; treePath?: string } | null;
  /** Tree column width on a wide screen, in px. */
  treeWidth?: number;
  /** Scroll cap of the tree pane on a wide screen, in vh. */
  treeMaxHeight?: number;
  /** Fixed height of the preview body, in vh. */
  previewHeight?: number;
  /** Floor under the whole browser, in vh; omitted, the panes decide its height. */
  minHeight?: number;
  className?: string;
  onToggleDir: (dir: string) => void;
  onOpenFile: (path: string) => void;
}

export function FileBrowser<Row extends FileTreeRow>({
  rows,
  treeLabel,
  selectedPath,
  loadingDirs,
  toggled = null,
  rowTrailing,
  treeLoading = false,
  treeError = null,
  headerFallback,
  headerPath,
  preview,
  emptyPreview,
  emptyDirLabel,
  truncatedLabel,
  unsupportedLabel,
  downloadLabel,
  stripFrontmatter = false,
  resolveRef,
  treeWidth = DEFAULT_TREE_WIDTH,
  treeMaxHeight = DEFAULT_TREE_MAX_HEIGHT,
  previewHeight = DEFAULT_PREVIEW_HEIGHT,
  minHeight,
  className = "",
  onToggleDir,
  onOpenFile,
}: FileBrowserProps<Row>) {
  // The sizes ride in as custom properties rather than as classes: a media query decides where
  // each one applies (the tree column exists only from `md` up), which an inline style cannot
  // say, and a class name composed at runtime is one Tailwind never sees to generate.
  const sizes = {
    "--fb-tree-width": `${treeWidth}px`,
    "--fb-tree-max-height": `${treeMaxHeight}vh`,
    "--fb-preview-height": `${previewHeight}vh`,
    "--fb-min-height": minHeight === undefined ? "0px" : `${minHeight}vh`,
  } as CSSProperties;

  /**
   * The Markdown adapters, rebuilt only when the host's resolver changes: react-markdown takes
   * these as element types, so a fresh map every render would remount the whole body. `Md`
   * keeps its own fenced-code adapter underneath; the link and image ones are replaced by ones
   * that know the browsed files.
   */
  const markdownComponents = useMemo<Components>(() => {
    /** What a reference of the file's own points at; null for an external or unresolved one. */
    const target = (ref: string): { url: string; treePath?: string } | null => {
      if (EXTERNAL_REF_RE.test(ref)) return null;
      return resolveRef?.(ref) ?? null;
    };
    return {
      img: ({ src, alt }) => {
        const resolved = typeof src === "string" ? target(src) : null;
        const url = resolved === null ? src : resolved.url;
        return <img src={url} alt={alt ?? ""} loading="lazy" className="max-w-full" />;
      },
      a: ({ href, children }) => {
        // An in-page anchor keeps the default behaviour; a link out of the browsed files opens
        // in a tab of its own, so it never navigates the app away from what is being read.
        if (typeof href !== "string" || href.startsWith("#")) return <a href={href}>{children}</a>;
        if (EXTERNAL_REF_RE.test(href)) {
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        }
        const resolved = target(href);
        if (resolved === null) return <a href={href}>{children}</a>;
        const treePath = resolved.treePath;
        return (
          <a
            href={resolved.url}
            onClick={(event) => {
              // A file this browser holds opens in the preview pane instead of navigating.
              if (treePath === undefined) return;
              event.preventDefault();
              onOpenFile(treePath);
            }}
          >
            {children}
          </a>
        );
      },
    };
  }, [resolveRef, onOpenFile]);

  /** What the header names: the file that is open, or what the browser is over while none is. */
  const headerLine = (): string => {
    if (preview === null) return headerFallback;
    return headerPath ?? preview.path;
  };

  /** The note under a preview that stopped short of the whole file. */
  const truncatedNote = (p: FileBrowserPreview): ReactNode => {
    if (p.truncated !== true) return null;
    return <p className="mt-2 text-xs text-fg-subtle">{truncatedLabel}</p>;
  };

  const previewBody = (): ReactNode => {
    if (preview === null) {
      // Nothing open yet. While the listing is still in flight there is nothing to open
      // either, so the pane waits with the tree rather than announcing an empty browser; a
      // listing that failed is done waiting, and the host's empty text says what happened.
      if (treeLoading && treeError === null) return <SkeletonList rows={8} />;
      return <p className="text-sm text-fg-subtle">{emptyPreview}</p>;
    }
    if (preview.loading === true) return <SkeletonList rows={8} />;
    if (preview.error !== undefined) {
      return <p className="text-sm text-tone-danger-fg">{preview.error}</p>;
    }
    if (preview.kind === "image") {
      return (
        <img
          src={preview.url}
          alt={preview.name}
          loading="lazy"
          className="max-w-full rounded-md border border-line"
        />
      );
    }
    if (preview.kind === "pdf") {
      return (
        <iframe
          src={preview.url}
          title={preview.name}
          className="h-[50vh] w-full rounded-md border border-line"
        />
      );
    }
    if (preview.kind === "md") {
      const text = preview.content ?? "";
      return (
        <>
          <div className="md-body text-sm text-fg">
            <Md
              text={stripFrontmatter ? bodyWithoutFrontmatter(text) : text}
              components={markdownComponents}
            />
          </div>
          {truncatedNote(preview)}
        </>
      );
    }
    if (preview.kind === "text") {
      const code = preview.content ?? "";
      return (
        <>
          <CodeBlock
            language={languageForFileName(preview.name)}
            code={code}
            highlight={code.length <= HIGHLIGHT_LIMIT}
          />
          {truncatedNote(preview)}
        </>
      );
    }
    return <p className="text-sm text-fg-muted">{unsupportedLabel}</p>;
  };

  return (
    <div
      style={sizes}
      className={`grid min-h-[var(--fb-min-height)] grid-cols-1 overflow-hidden rounded-md border border-line md:grid-cols-[var(--fb-tree-width)_minmax(0,1fr)] ${className}`}
    >
      {/* Both panes scroll on their own inside fixed heights, so whatever the host draws above
          the browser stays put while a file is read. */}
      <aside className="border-b border-line bg-surface-inset/60 md:border-b-0 md:border-r">
        <div className="max-h-44 overflow-y-auto md:max-h-[var(--fb-tree-max-height)]">
          {treeError !== null && (
            <p className="px-3 py-2 text-xs text-tone-danger-fg">{treeError}</p>
          )}
          {/* A `tree` with no `treeitem` in it is not one: while the listing is in flight, or
              when it failed or held nothing, the aside carries the skeleton or the error and
              no tree at all. */}
          {rows.length === 0 && treeLoading && treeError === null && <SkeletonList rows={3} />}
          {rows.length > 0 && (
            <FileTree
              rows={rows}
              label={treeLabel}
              selectedPath={selectedPath}
              loadingDirs={loadingDirs}
              toggled={toggled}
              rowTrailing={rowTrailing}
              emptyLabel={emptyDirLabel}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
            />
          )}
        </div>
      </aside>

      <section className="min-w-0">
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-fg-muted">{headerLine()}</p>
          </div>
          {preview !== null && preview.downloadUrl !== undefined && (
            <a
              href={preview.downloadUrl}
              download={preview.name}
              className="rounded-control px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors duration-150 hover:bg-line-muted hover:text-fg"
            >
              {downloadLabel}
            </a>
          )}
        </div>
        <div className="max-h-[var(--fb-preview-height)] min-h-[var(--fb-preview-height)] overflow-auto p-3">
          {previewBody()}
        </div>
      </section>
    </div>
  );
}
