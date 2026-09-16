/**
 * The handbook's file list, drawn by the app's shared `FileTree` — the same tree the
 * conversation page's Workspace panel and the plugin library's file browser draw, so a reader
 * who knows one knows this one: the same row height and indent, the same chevrons and folder /
 * document glyphs, the same selection treatment, the same WAI-ARIA keyboard walk with one
 * roving tab stop, and the same subtree animation on open and close.
 *
 * What this file adds is the handbook's own semantics, which is all that is left once the
 * drawing is shared: the index (`README.md`, the page every trigger makes the employee read
 * first) leads the rows rather than sorting into them, and it is the one row whose accessible
 * name says why — its visible text is only a file name. Beside a document's name sits how long
 * ago it was written, beside a folder's how many documents it holds, and the whole path, the
 * exact time and the size ride in the tooltip: a second line under one row's name would cost
 * every row the same height for a fact about that one.
 *
 * The rows themselves are `handbook-tree.ts`'s (`handbookTreeRows`); folders start collapsed and
 * the page expands the ones above the selected document.
 */
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatBytes, formatDateTime, formatRelativeShort } from "../../lib/format";
import type { Locale } from "../../state/locale";
import { FileTree } from "../../components/ui/file-tree";
import type { TreeToggle } from "../../components/ui/file-tree";
import type { HandbookRow } from "./handbook-tree";

/** Collapse-all mark (lucide chevrons-down-up): two chevrons closing on each other. */
export const COLLAPSE_ALL_ICON = "m7 20 5-5 5 5M7 4l5 5 5-5";

/** How a row's tooltip spells "written then, this big"; empty for a row the listing has lost. */
function writtenAt(file: OrgHandbookFile | null): string[] {
  if (file === null) return [];
  return [S.company.handbook.updatedAt(formatDateTime(file.updatedAt), formatBytes(file.size))];
}

export function HandbookExplorer({
  rows,
  selected,
  locale,
  toggled,
  onSelect,
  onToggle,
}: {
  rows: readonly HandbookRow[];
  selected: string;
  locale: Locale;
  /** The folder last opened or closed, whose subtree animates. Null: nothing to animate. */
  toggled: TreeToggle | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const tooltip = (row: HandbookRow): string =>
    (row.kind === "dir"
      ? [row.path, S.company.handbook.documentsInFolder(row.docs)]
      : [row.path, ...(row.isIndex ? [S.company.handbook.indexLabel] : []), ...writtenAt(row.file)]
    ).join(" · ");

  return (
    <FileTree
      rows={rows}
      label={S.company.handbook.documents}
      selectedPath={selected}
      toggled={toggled}
      rowTitle={tooltip}
      // Only the index overrides its name: every other row says on screen everything it means.
      rowLabel={(row) => (row.isIndex ? tooltip(row) : undefined)}
      rowTrailing={(row) => (
        <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
          {row.kind === "dir"
            ? row.docs
            : row.file === null
              ? ""
              : formatRelativeShort(row.file.updatedAt, locale)}
        </span>
      )}
      onToggleDir={onToggle}
      onOpenFile={onSelect}
    />
  );
}
