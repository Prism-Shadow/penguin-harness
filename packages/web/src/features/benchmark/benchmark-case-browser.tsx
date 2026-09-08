/**
 * The Benchmark case dialog's files: the shared read-only browser (the one the plugin detail
 * Modal draws) over a case's two materials. The tree's two top-level directories are the
 * materials themselves — the task materials the tested agent is given, and the rubric it never
 * sees — both open from the start, each listed one directory per level as it is opened, the
 * way the Workspace files panel lists.
 *
 * Row paths carry the material they belong to (`statement/README.md`), since the two are
 * separate file spaces whose paths would otherwise collide; every request splits the material
 * back off before asking for a path inside it. The statement's own README opens by itself once
 * its listing arrives, so the dialog lands on what the case is about.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BenchmarkCaseSummary,
  CaseMaterial,
  WorkspaceFileEntry,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { joinWorkspacePath } from "../../lib/file-path";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import {
  ancestorDirs,
  baseName,
  expandTo,
  parentDir,
  withExpanded,
} from "../../lib/workspace-tree";
import type { Listings } from "../../lib/workspace-tree";
import type { FileTreeRow } from "../../lib/file-tree";
import { FileBrowser, previewKindOf } from "../../components/ui/file-browser";
import type { FileBrowserPreview } from "../../components/ui/file-browser";
import type { TreeToggle } from "../../components/ui/file-tree";

/** One row of the case tree: a shared tree row, which material it came from, and a file's size. */
export interface CaseTreeRow extends FileTreeRow {
  material: CaseMaterial;
  /** Bytes on a file row, 0 on a directory. */
  sizeBytes: number;
}

/** A material as the tree draws it: which one, and the name of the folder it stands under. */
export interface CaseMaterialSpec {
  material: CaseMaterial;
  label: string;
}

/** The two materials' own tree paths, which are also the directories the tree opens with. */
const MATERIAL_PATHS = ["statement", "rubric"];

/**
 * The rows the tree draws, top to bottom: one directory row per material, then a depth-first
 * walk into every open directory whose listing has arrived. An open directory that is still
 * loading contributes its own row and no children — `loaded: false` is what tells the tree so.
 *
 * `listings` and `expanded` are keyed by tree path, a material's own row being its bare name,
 * so one map and one set cover both materials without either shadowing the other.
 */
export function caseTreeRows(
  materials: readonly CaseMaterialSpec[],
  listings: Listings,
  expanded: ReadonlySet<string>,
): CaseTreeRow[] {
  const rows: CaseTreeRow[] = [];
  const walk = (material: CaseMaterial, dir: string, depth: number): void => {
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
        material,
        sizeBytes: entry.sizeBytes,
      });
      if (open && children !== undefined) walk(material, path, depth + 1);
    }
  };
  for (const [index, spec] of materials.entries()) {
    const children = listings.get(spec.material);
    const open = expanded.has(spec.material);
    rows.push({
      path: spec.material,
      name: spec.label,
      kind: "dir",
      depth: 0,
      posInSet: index + 1,
      setSize: materials.length,
      expanded: open,
      loaded: children !== undefined,
      empty: children !== undefined && children.length === 0,
      material: spec.material,
      sizeBytes: 0,
    });
    if (open && children !== undefined) walk(spec.material, spec.material, 1);
  }
  return rows;
}

/** The material a tree path belongs to, and the path inside it ("" for the material's own row). */
function splitTreePath(treePath: string): { material: CaseMaterial; path: string } {
  const cut = treePath.indexOf("/");
  const head = cut < 0 ? treePath : treePath.slice(0, cut);
  return {
    material: head === "rubric" ? "rubric" : "statement",
    path: cut < 0 ? "" : treePath.slice(cut + 1),
  };
}

/** A reference written inside a file, resolved against the directory that file sits in. */
function resolveRelative(baseDir: string, ref: string): string {
  const out = ref.startsWith("/") || baseDir === "" ? [] : baseDir.split("/");
  for (const segment of ref.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

interface Props {
  projectId: string;
  benchmarkId: string;
  caseSummary: BenchmarkCaseSummary;
  /**
   * The machine whose disk holds this Case's files; null for this server. A Benchmark's Cases
   * can be read off any machine that has them, and the listing this browser was opened from
   * recorded which one — asking a different server for the same path is asking about a
   * directory it may not have.
   */
  machineId: string | null;
}

export function BenchmarkCaseBrowser({ projectId, benchmarkId, caseSummary, machineId }: Props) {
  const { locale } = useLocale();
  /** Listings by tree path; a missing key means "not fetched yet". */
  const [listings, setListings] = useState<Listings>(() => new Map());
  /** Both materials start open, so the case's files are in view without a click. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(MATERIAL_PATHS));
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [listError, setListError] = useState<string | null>(null);
  /** The directory whose subtree the tree should animate — the one just clicked. */
  const [toggled, setToggled] = useState<TreeToggle | null>(null);
  const [preview, setPreview] = useState<FileBrowserPreview | null>(null);
  /** Answers to superseded preview requests are dropped rather than painted over the new one. */
  const previewRequest = useRef(0);
  /** Per-directory request counter, for the same reason, one listing at a time. */
  const dirRequest = useRef<Map<string, number>>(new Map());
  const readmeOpened = useRef(false);

  const fileUrl = useCallback(
    (
      material: CaseMaterial,
      filePath: string,
      options?: { download?: boolean; preview?: boolean },
    ) =>
      api.benchmarkCaseFileUrl(projectId, benchmarkId, caseSummary.id, filePath, material, {
        ...options,
        machineId,
      }),
    [projectId, benchmarkId, caseSummary.id, machineId],
  );

  /**
   * Fetches one directory's listing into the tree, keyed by its tree path. Resolves with the
   * entries, or null when the request failed or a newer one for the same directory overtook it.
   */
  const loadDir = useCallback(
    async (treePath: string): Promise<readonly WorkspaceFileEntry[] | null> => {
      const { material, path } = splitTreePath(treePath);
      const seq = (dirRequest.current.get(treePath) ?? 0) + 1;
      dirRequest.current.set(treePath, seq);
      const current = (): boolean => dirRequest.current.get(treePath) === seq;
      setLoadingDirs((s) => new Set(s).add(treePath));
      try {
        const res = await api.listBenchmarkCaseFiles(
          projectId,
          benchmarkId,
          caseSummary.id,
          path,
          material,
          machineId,
        );
        if (!current()) return null;
        setListings((m) => new Map(m).set(treePath, res.entries));
        setListError(null);
        return res.entries;
      } catch (error) {
        if (!current()) return null;
        setListError(apiErrorText(error));
        return null;
      } finally {
        if (current()) {
          setLoadingDirs((s) => {
            const next = new Set(s);
            next.delete(treePath);
            return next;
          });
        }
      }
    },
    [projectId, benchmarkId, caseSummary.id, machineId],
  );

  /** Opens a file in the preview pane: the text kinds are read, the rest are served by URL. */
  const openFile = useCallback(
    async (treePath: string): Promise<void> => {
      const { material, path } = splitTreePath(treePath);
      const name = baseName(path);
      const kind = previewKindOf(name);
      const base: FileBrowserPreview = {
        path: treePath,
        name,
        kind,
        url: fileUrl(material, path),
        downloadUrl: fileUrl(material, path, { download: true }),
      };
      const request = ++previewRequest.current;
      if (kind !== "text" && kind !== "md") {
        setPreview(base);
        return;
      }
      setPreview({ ...base, loading: true });
      try {
        const response = await fetch(fileUrl(material, path, { preview: true }), {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(String(response.status));
        const content = await response.text();
        if (request !== previewRequest.current) return;
        setPreview({
          ...base,
          content,
          truncated: response.headers.get("x-content-truncated") === "1",
        });
      } catch (error) {
        if (request !== previewRequest.current) return;
        setPreview({ ...base, error: apiErrorText(error) });
      }
    },
    [fileUrl],
  );

  // A different case is a different set of files: nothing of the last one carries over.
  useEffect(() => {
    setListings(new Map());
    setExpanded(new Set(MATERIAL_PATHS));
    setLoadingDirs(new Set());
    setListError(null);
    setToggled(null);
    setPreview(null);
    // The request counters are deliberately not reset: a listing still in flight for the case
    // being left would otherwise match the new case's first request and land in its tree.
    readmeOpened.current = false;
  }, [projectId, benchmarkId, caseSummary.id, machineId]);

  useEffect(() => {
    void loadDir("rubric");
    // The statement's own README is what the case is about, so it opens by itself; the rubric
    // side carries no such auto-preview, or the two listings would race for the pane.
    void loadDir("statement").then((entries) => {
      if (entries === null || readmeOpened.current) return;
      const readme = entries.find(
        (entry) => entry.kind === "file" && entry.name.toLowerCase() === "readme.md",
      );
      if (readme === undefined) return;
      readmeOpened.current = true;
      void openFile(joinWorkspacePath("statement", readme.name));
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
   * Opens a file and makes its row reachable: a link inside a Markdown file can point at a
   * directory the tree has never listed, and a preview of a file with no row to highlight
   * would leave the tree pointing at the file before it.
   */
  const openAndReveal = (treePath: string): void => {
    setExpanded((s) => expandTo(s, treePath));
    for (const dir of ancestorDirs(treePath)) {
      if (dir !== "" && !listings.has(dir)) void loadDir(dir);
    }
    void openFile(treePath);
  };

  /** A relative reference in a previewed Markdown file, resolved within its own material. */
  const resolveRef = useCallback(
    (ref: string): { url: string; treePath?: string } | null => {
      if (preview === null) return null;
      const { material, path } = splitTreePath(preview.path);
      const target = resolveRelative(parentDir(path), ref);
      return { url: fileUrl(material, target), treePath: joinWorkspacePath(material, target) };
    },
    [preview, fileUrl],
  );

  const materials: CaseMaterialSpec[] = [
    { material: "statement", label: S.benchmark.taskMaterials },
    { material: "rubric", label: S.benchmark.rubric },
  ];

  /** The header names the material and the path inside it, not the prefixed tree path. */
  const headerPath = (): string | undefined => {
    if (preview === null) return undefined;
    const { material, path } = splitTreePath(preview.path);
    const label = material === "rubric" ? S.benchmark.rubric : S.benchmark.taskMaterials;
    return `${label} / ${path}`;
  };

  const rowTrailing = (row: CaseTreeRow): ReactNode => {
    // The rubric is what the case is scored against, and the tested agent never sees it: the
    // badge says so where the folder is, rather than in a note under the tree.
    if (row.depth === 0) {
      if (row.material !== "rubric") return null;
      return (
        <span className="shrink-0 rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {S.benchmark.agentHidden}
        </span>
      );
    }
    if (row.kind !== "file") return null;
    return (
      <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">
        {formatBytes(row.sizeBytes)}
      </span>
    );
  };

  // One fixed width per language, so opening or closing a folder never moves the preview beside
  // the tree. It is sized to the rubric folder's row, whose name shares the row with the
  // hidden-from-agent badge: the English pair takes about 320px at the default 18px root and the
  // Chinese pair about 230px. A longer file name is cut, and its row's tooltip holds the path.
  return (
    <FileBrowser
      rows={caseTreeRows(materials, listings, expanded)}
      treeLabel={S.files.treeLabel}
      selectedPath={preview?.path ?? null}
      loadingDirs={loadingDirs}
      toggled={toggled}
      rowTrailing={rowTrailing}
      treeLoading={listings.size === 0 && listError === null}
      treeError={listError}
      headerFallback={caseSummary.id}
      headerPath={headerPath()}
      preview={preview}
      emptyPreview={S.benchmark.caseFileUnavailable}
      resolveRef={resolveRef}
      treeWidth={locale === "en" ? 330 : 240}
      treeMaxHeight={53}
      previewHeight={52}
      minHeight={58}
      onToggleDir={toggleDir}
      onOpenFile={openAndReveal}
    />
  );
}
