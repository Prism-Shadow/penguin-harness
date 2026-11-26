/**
 * A directory read in the shared read-only file browser (the UI package's `FileBrowser`, the one
 * the plugin detail draws): listed one level at a time through the Files panel's routes as its
 * folders are opened, a file previewed on the right with a Download link. Nothing here writes.
 *
 * - On arrival the root is listed, and the first of the caller's `lead` names found there opens
 *   by itself (compared without case), so the browser lands on what the directory is about.
 * - The text kinds are read through the bounded text read (lib/text-preview.ts), HTML as its
 *   source — rendering it would take the Files panel's sandboxed frame. A name that says nothing
 *   about its kind (a script with no extension, a LICENSE) is read only when its first bytes look
 *   like text, and offered as a download otherwise. Images and PDFs load from their own URLs.
 * - A relative link in a Markdown file opens its target in place and reveals its row.
 * - Entries the caller `skip`s are never listed; with `stripFrontmatter`, a Markdown preview reads
 *   the body under a leading frontmatter block.
 * - Another directory is another browser: a changed scope starts over with nothing carried.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import { FileBrowser, type FileBrowserPreview, type TreeToggle } from "@prismshadow/penguin-ui";
import { filesApi, filesScopeKey, type FilesScope } from "../../api/workspace-files";
import { formatBytes } from "../../lib/format";
import { useReaderFind } from "../../lib/reader-find";
import { S } from "../../lib/strings";
import { fetchTextPreview } from "../../lib/text-preview";
import {
  ancestorDirs,
  baseName,
  expandTo,
  flattenTree,
  parentDir,
  previewKindFor,
  resolveRelative,
  withExpanded,
  type Listings,
  type TreeRow,
} from "../../lib/workspace-tree";
import { failureNode } from "../../lib/failure";

export interface DirBrowserProps {
  /** The directory, as the Files panel addresses one. */
  scope: FilesScope;
  /** The header line while no file is previewed. */
  headerFallback: string;
  /** Root-level names to open on arrival: the first that exists, compared without case. */
  lead?: readonly string[];
  /** Entries left out of the tree. */
  skip?: (entry: WorkspaceFileEntry) => boolean;
  /** Markdown previews drop a leading frontmatter block: the caller shows those fields already. */
  stripFrontmatter?: boolean;
}

/** A directory read in the shared read-only FileBrowser: listed one level at a time through the Files panel's routes, a file previewed on the right. Nothing here writes. */
/** The directory on screen, kept out of every report the browser offers (`<workspace>`). */
function privacyOf(scope: FilesScope): { privatePaths: readonly string[] } {
  return { privatePaths: scope.kind === "workspace" ? [scope.workspace] : [] };
}

export function DirBrowser(props: DirBrowserProps): ReactElement {
  // Keyed by the directory, so another one remounts the browser with nothing of the last.
  return <DirBrowserBody key={filesScopeKey(props.scope)} {...props} />;
}

function DirBrowserBody({
  scope,
  headerFallback,
  lead,
  skip,
  stripFrontmatter = false,
}: DirBrowserProps) {
  // The key above pins the scope for this instance's life; the caller builds a fresh object
  // every render, so the API is built once rather than from each one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const files = useMemo(() => filesApi(scope), []);
  // The caller's lists, read when an answer lands: a new function or array from a render must
  // not restart the reads.
  const skipRef = useRef(skip);
  skipRef.current = skip;
  const leadRef = useRef(lead);
  leadRef.current = lead;

  /** Listings by directory ("" is the root); a missing key means "not fetched yet". */
  const [listings, setListings] = useState<Listings>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [listError, setListError] = useState<ReactNode>(null);
  /** The directory whose subtree the tree should animate — the one just clicked. */
  const [toggled, setToggled] = useState<TreeToggle | null>(null);
  const [preview, setPreview] = useState<FileBrowserPreview | null>(null);
  /** Answers to superseded preview requests are dropped rather than painted over the new one. */
  const previewRequest = useRef(0);
  /** Per-directory request counter, for the same reason, one listing at a time. */
  const dirRequest = useRef<Map<string, number>>(new Map());

  /**
   * Fetches one directory's listing into the tree. Resolves with the entries it keeps, or null
   * when the request failed or a newer one for the same directory overtook it.
   */
  const loadDir = useCallback(
    async (dir: string): Promise<readonly WorkspaceFileEntry[] | null> => {
      const seq = (dirRequest.current.get(dir) ?? 0) + 1;
      dirRequest.current.set(dir, seq);
      const current = (): boolean => dirRequest.current.get(dir) === seq;
      setLoadingDirs((s) => new Set(s).add(dir));
      try {
        const res = await files.list(dir);
        if (!current()) return null;
        const leftOut = skipRef.current;
        const entries =
          leftOut === undefined ? res.entries : res.entries.filter((entry) => !leftOut(entry));
        setListings((m) => new Map(m).set(dir, entries));
        setListError(null);
        return entries;
      } catch (error) {
        if (!current()) return null;
        setListError(failureNode(error, privacyOf(scope)));
        return null;
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
    [files],
  );

  /** Opens a file in the preview pane: the text kinds are read, images and PDFs served by URL. */
  const openFile = useCallback(
    async (path: string): Promise<void> => {
      const name = baseName(path);
      const kind = previewKindFor(name);
      const url = files.fileUrl(path);
      const base = { path, name, url, downloadUrl: files.fileUrl(path, true) };
      const request = ++previewRequest.current;
      if (kind === "image" || kind === "pdf") {
        setPreview({ ...base, kind });
        return;
      }
      const shown = kind === "md" ? "md" : "text";
      setPreview({ ...base, kind: shown, loading: true });
      try {
        const result = await fetchTextPreview(url, kind === "unknown");
        if (request !== previewRequest.current) return;
        setPreview(
          result === null
            ? { ...base, kind: "unsupported" }
            : { ...base, kind: shown, content: result.content, truncated: result.truncated },
        );
      } catch (error) {
        if (request !== previewRequest.current) return;
        setPreview({ ...base, kind: shown, error: failureNode(error, privacyOf(scope)) });
      }
    },
    [files],
  );

  useEffect(() => {
    void loadDir("").then((entries) => {
      if (entries === null) return;
      for (const name of leadRef.current ?? []) {
        const found = entries.find(
          (entry) => entry.kind === "file" && entry.name.toLowerCase() === name.toLowerCase(),
        );
        if (found !== undefined) {
          void openFile(found.name);
          return;
        }
      }
    });
  }, [loadDir, openFile]);

  /** Opens or closes a directory; a first open fetches its listing. */
  const toggleDir = (dir: string): void => {
    const open = !expanded.has(dir);
    setExpanded((s) => withExpanded(s, dir, open));
    // The serial makes toggling the same directory again a new event for the tree to animate.
    setToggled((last) => ({ dir, open, serial: (last?.serial ?? 0) + 1 }));
    if (open && !listings.has(dir)) void loadDir(dir);
  };

  /**
   * Opens a file and makes its row reachable: a link inside a Markdown file can point into a
   * directory the tree has never listed.
   */
  const openAndReveal = (path: string): void => {
    setExpanded((s) => expandTo(s, path));
    for (const dir of ancestorDirs(path)) {
      if (dir !== "" && !listings.has(dir)) void loadDir(dir);
    }
    void openFile(path);
  };

  /** A relative reference in a previewed Markdown file, resolved against that file's folder. */
  const resolveRef = useCallback(
    (ref: string): { url: string; treePath: string } | null => {
      if (preview === null) return null;
      const target = resolveRelative(parentDir(preview.path), ref);
      return { url: files.fileUrl(target), treePath: target };
    },
    [preview, files],
  );

  const readerFind = useReaderFind();

  const rowTrailing = (row: TreeRow): ReactNode =>
    row.kind !== "file" ? null : (
      <span className="shrink-0 font-mono text-xs text-fg-subtle">
        {formatBytes(row.sizeBytes)}
      </span>
    );

  return (
    <FileBrowser
      rows={flattenTree(listings, expanded)}
      treeLabel={S.files.treeLabel}
      selectedPath={preview?.path ?? null}
      loadingDirs={loadingDirs}
      toggled={toggled}
      rowTrailing={rowTrailing}
      treeLoading={listings.size === 0 && listError === null}
      treeError={listError}
      headerFallback={headerFallback}
      preview={preview}
      emptyPreview={S.files.selectFile}
      emptyDirLabel={S.files.empty}
      truncatedLabel={S.files.previewTruncated}
      unsupportedLabel={S.files.previewUnsupported}
      downloadLabel={S.files.download}
      stripFrontmatter={stripFrontmatter}
      resolveRef={resolveRef}
      isFindKey={readerFind.isFindKey}
      findShortcut={readerFind.findShortcut}
      onToggleDir={toggleDir}
      onOpenFile={openAndReveal}
    />
  );
}
