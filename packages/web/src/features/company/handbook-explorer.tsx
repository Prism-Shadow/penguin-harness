/**
 * The handbook's file list as an explorer tree, the shape every editor's sidebar uses: the
 * index pinned at the top, then folders before documents at every level, each row indented by
 * its depth with a guide line back to its parent. A folder row toggles; a document row selects
 * and the pane beside it follows. Folders start collapsed — the page opens on the index, not on
 * the whole directory — and the ones above the selected document are expanded for it, so a link
 * followed inside a document reveals where that document lives.
 *
 * The tree is one tab stop with roving focus (`role="tree"`, one `treeitem` per row): the arrows
 * walk the rows that are actually visible, Right opens a folder or steps into it, Left closes it
 * or steps out to its parent, and Enter acts on the focused row. The rows are a flat run of
 * `treeitem`s carrying `aria-level`, which is what lets a collapsed folder cost nothing to render
 * and keeps the DOM order the reading order.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatBytes, formatDateTime, formatRelativeShort } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import type { Locale } from "../../state/locale";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON, FOLDER_OPEN_ICON } from "../../components/ui/group-list";
import { FILE_ICON, NAV_ICONS } from "../../components/ui/icons";
import { HANDBOOK_INDEX, ancestorFolders, countDocuments, flattenVisible } from "./handbook-tree";
import type { HandbookNode } from "./handbook-tree";

/** Collapse-all mark (lucide chevrons-down-up): two chevrons closing on each other. */
export const COLLAPSE_ALL_ICON = "m7 20 5-5 5 5M7 4l5 5 5-5";

/** The row's left padding at depth 0, and how much one level adds. */
const ROOT_INDENT = 8;
const INDENT_STEP = 14;

/** One rendered row: a node of the tree, or the pinned index, which belongs to no folder. */
interface ExplorerRow {
  path: string;
  depth: number;
  node: HandbookNode | null;
}

export function HandbookExplorer({
  index,
  nodes,
  selected,
  expanded,
  locale,
  onSelect,
  onToggle,
}: {
  /** The index's listing entry, or null while the listing lacks it. */
  index: OrgHandbookFile | null;
  nodes: readonly HandbookNode[];
  selected: string;
  expanded: ReadonlySet<string>;
  locale: Locale;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const rows: ExplorerRow[] = [
    { path: HANDBOOK_INDEX, depth: 0, node: null },
    ...flattenVisible(nodes, expanded).map((r) => ({
      path: r.node.path,
      depth: r.depth,
      node: r.node,
    })),
  ];
  // Roving focus: exactly one row is tabbable, and the arrows move it. It follows the selection
  // so that tabbing into the tree lands on the document on screen rather than at the top.
  const [active, setActive] = useState(selected);
  useEffect(() => setActive(selected), [selected]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const focused = rows.some((r) => r.path === active) ? active : (rows[0]?.path ?? HANDBOOK_INDEX);

  const focus = (path: string) => {
    setActive(path);
    refs.current.get(path)?.focus();
  };
  const step = (delta: number) => {
    const at = rows.findIndex((r) => r.path === focused);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
    if (next !== undefined) focus(next.path);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const row = rows.find((r) => r.path === focused);
    if (row === undefined) return;
    const folder = row.node !== null && row.node.kind === "folder" ? row.node : null;
    const open = folder !== null && expanded.has(folder.path);
    switch (e.key) {
      case "ArrowDown":
        step(1);
        break;
      case "ArrowUp":
        step(-1);
        break;
      case "Home":
        focus(rows[0]!.path);
        break;
      case "End":
        focus(rows[rows.length - 1]!.path);
        break;
      case "ArrowRight":
        if (folder === null) return;
        if (open) step(1);
        else onToggle(folder.path);
        break;
      case "ArrowLeft": {
        if (open) {
          onToggle(folder.path);
          break;
        }
        const parents = ancestorFolders(row.path);
        const parent = parents[parents.length - 1];
        if (parent === undefined) return;
        focus(parent);
        break;
      }
      case "Enter":
      case " ":
        if (folder !== null) onToggle(folder.path);
        else onSelect(row.path);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div role="tree" aria-label={S.company.handbook.documents} onKeyDown={onKeyDown}>
      {rows.map((row) => (
        <ExplorerRowButton
          key={row.path}
          row={row}
          index={index}
          selected={selected === row.path}
          expanded={row.node?.kind === "folder" && expanded.has(row.path)}
          tabbable={focused === row.path}
          locale={locale}
          register={(el) => {
            if (el === null) refs.current.delete(row.path);
            else refs.current.set(row.path, el);
          }}
          onActivate={() => {
            setActive(row.path);
            if (row.node?.kind === "folder") onToggle(row.path);
            else onSelect(row.path);
          }}
        />
      ))}
    </div>
  );
}

/**
 * One row: the indent guides of the levels above it, its twisty (folders only), its glyph, its
 * name — with the index's reason for being pinned under it — and, on the right, how long ago a
 * document was written or how many documents a folder holds. The whole path, the exact time and
 * the size ride in the tooltip. The selected row is filled rather than merely bold, so the pane
 * beside it reads as that row's.
 */
function ExplorerRowButton({
  row,
  index,
  selected,
  expanded,
  tabbable,
  locale,
  register,
  onActivate,
}: {
  row: ExplorerRow;
  index: OrgHandbookFile | null;
  selected: boolean;
  expanded: boolean;
  tabbable: boolean;
  locale: Locale;
  register: (el: HTMLButtonElement | null) => void;
  onActivate: () => void;
}) {
  const node = row.node;
  const folder = node !== null && node.kind === "folder" ? node : null;
  const file = node === null ? index : node.kind === "file" ? node.file : null;
  const name = node === null ? HANDBOOK_INDEX : node.name;
  const style: CSSProperties = { paddingLeft: ROOT_INDENT + row.depth * INDENT_STEP };
  const glyph =
    folder !== null
      ? expanded
        ? FOLDER_OPEN_ICON
        : FOLDER_ICON
      : node === null
        ? NAV_ICONS.orgHandbook
        : FILE_ICON;
  const tooltip =
    folder !== null
      ? `${row.path} · ${S.company.handbook.documentsInFolder(countDocuments(folder.children))}`
      : file === null
        ? row.path
        : `${file.path} · ${S.company.handbook.updatedAt(formatDateTime(file.updatedAt), formatBytes(file.size))}`;
  return (
    <button
      type="button"
      ref={register}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      {...(folder !== null ? { "aria-expanded": expanded } : {})}
      tabIndex={tabbable ? 0 : -1}
      title={tooltip}
      onClick={onActivate}
      style={style}
      className={`relative flex w-full items-center ${ICON_GAP.row} rounded-md py-1.5 pr-2 text-left text-sm transition-colors duration-150 ${
        selected
          ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          : "hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}
    >
      {/* The indent guides: one hairline per level above this row, at that level's twisty. */}
      {Array.from({ length: row.depth }, (_, i) => (
        <span
          key={i}
          aria-hidden
          style={{ left: ROOT_INDENT + i * INDENT_STEP + 6 }}
          className="absolute bottom-0 top-0 w-px bg-gray-200 dark:bg-gray-800"
        />
      ))}
      <span className="flex w-3 shrink-0 justify-center text-gray-400 dark:text-gray-500">
        {folder !== null && <Chevron open={expanded} size={ICON_SIZE.chevronDense} />}
      </span>
      <span
        className={`shrink-0 ${selected ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}`}
      >
        <GlyphIcon d={glyph} size={ICON_SIZE.rowLead} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name}</span>
        {node === null && (
          <span className="block truncate text-[11px] font-normal text-gray-500 dark:text-gray-400">
            {S.company.handbook.indexLabel}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] font-normal tabular-nums text-gray-400 dark:text-gray-500">
        {folder !== null
          ? countDocuments(folder.children)
          : file === null
            ? ""
            : formatRelativeShort(file.updatedAt, locale)}
      </span>
    </button>
  );
}
