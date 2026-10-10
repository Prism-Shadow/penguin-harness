/**
 * The Files panel's directory tree: the UI package's `FileTree` over the rows
 * lib/workspace-tree.ts flattens out of the lazily fetched listings. What this file adds is what
 * only the Workspace has — the size and modified time in a row's tooltip and after its name, the
 * directory uploads land in standing in for a selection while no file is open, and the three
 * things an empty row list can mean.
 */
import { FileTree } from "@prismshadow/penguin-ui";
import type { TreeToggle } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatBytes, formatDateTime } from "../../lib/format";
import type { TreeRow } from "../../lib/workspace-tree";

export function WorkspaceTreeView({
  rows,
  selectedPath,
  currentDir,
  loadingDirs,
  dropTargetDir,
  scrollTo,
  rootEmpty,
  filtering,
  toggled,
  onToggleDir,
  onOpenFile,
}: {
  rows: readonly TreeRow[];
  /** The file open in the preview (highlighted). */
  selectedPath: string | null;
  /** The directory uploads land in; highlighted while no file is selected. */
  currentDir: string;
  loadingDirs: ReadonlySet<string>;
  /** The folder a hovering file drag would drop into, or null while nothing is dragged. */
  dropTargetDir: string | null;
  /** A row to bring into view; a new object scrolls again even for the same path. */
  scrollTo: { path: string } | null;
  /** The root listing arrived and holds nothing. */
  rootEmpty: boolean;
  /** The search box holds a query, so no rows means "nothing loaded matches" rather than "empty". */
  filtering: boolean;
  /** The directory last opened or closed, whose subtree animates. Null: nothing to animate. */
  toggled: TreeToggle | null;
  onToggleDir: (dir: string) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <FileTree
      rows={rows}
      label={S.files.treeLabel}
      // With nothing open in the preview the highlight falls to the directory an upload would
      // land in, so the panel always shows where it is pointed.
      selectedPath={selectedPath ?? (currentDir === "" ? null : currentDir)}
      loadingDirs={loadingDirs}
      dropTargetDir={dropTargetDir}
      scrollTo={scrollTo}
      toggled={toggled}
      rowTitle={(row) =>
        row.kind === "file"
          ? `${row.path} · ${formatBytes(row.sizeBytes)} · ${formatDateTime(row.mtime)}`
          : row.path
      }
      rowTrailing={(row) =>
        row.kind === "file" && (
          <span className="shrink-0 font-mono text-xs text-fg-subtle">
            {formatBytes(row.sizeBytes)}
          </span>
        )
      }
      emptyLabel={S.files.empty}
      className="min-h-0 flex-1 overflow-auto"
      // Find-in-page region (components/find/find-bar.tsx): the Workspace tree is searchable by
      // file name. The lib/workspace search box on this same panel matches *contents* server
      // side and is a different thing — this one is look-at-what-is-on-screen.
      findRegion="files"
      onToggleDir={onToggleDir}
      onOpenFile={onOpenFile}
    >
      {filtering ? (
        <p className="px-3 py-2 text-sm text-fg-subtle">{S.files.searchNoMatch}</p>
      ) : rootEmpty ? (
        <p className="px-3 py-2 text-sm text-fg-subtle">{S.files.empty}</p>
      ) : null}
    </FileTree>
  );
}
