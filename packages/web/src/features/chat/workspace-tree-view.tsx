/**
 * The Files panel's directory tree: one row per entry on screen (lib/workspace-tree.ts
 * flattens the listings), indented by depth, a chevron and a folder glyph on directories,
 * a page glyph and the size on files. Clicking a directory opens or closes it, clicking a
 * file opens it in the preview.
 *
 * Keyboard: the WAI-ARIA tree pattern with a roving tab stop — one row is in the tab order
 * (the focused one, else the selected one, else the first), arrows move between rows and
 * open/close directories (treeKeyStep), Enter and Space act like a click.
 *
 * While OS files are dragged over the panel, the folder row that would receive them is
 * highlighted; the rows carry `data-tree-path` / `data-tree-kind` so the panel's drop
 * handling can resolve the row under the pointer.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { S } from "../../lib/strings";
import { formatBytes, formatDateTime } from "../../lib/format";
import { treeKeyStep } from "../../lib/workspace-tree";
import type { TreeRow } from "../../lib/workspace-tree";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON, FOLDER_OPEN_ICON } from "../../components/ui/group-list";
import { ICON_SIZE } from "../../lib/icon-scale";
import { FILE_ICON } from "./message-files-card";

/** Indent per nesting level, in px. */
const INDENT_PX = 14;

export function WorkspaceTreeView({
  rows,
  selectedPath,
  currentDir,
  loadingDirs,
  dropTargetDir,
  scrollTo,
  rootEmpty,
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
  onToggleDir: (dir: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const rowElement = (path: string): HTMLElement | null =>
    containerRef.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`) ??
    null;

  useEffect(() => {
    if (scrollTo === null) return;
    if (scrollTo.path === "") containerRef.current?.scrollTo({ top: 0 });
    else rowElement(scrollTo.path)?.scrollIntoView({ block: "nearest" });
  }, [scrollTo]);

  const activate = (row: TreeRow): void => {
    setFocused(row.path);
    if (row.kind === "dir") onToggleDir(row.path);
    else onOpenFile(row.path);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      const row = rows.find((r) => r.path === focused);
      if (row === undefined) return;
      e.preventDefault();
      activate(row);
      return;
    }
    const step = treeKeyStep(rows, focused, e.key);
    if (step === null) return;
    e.preventDefault();
    if (step.focus !== undefined) {
      setFocused(step.focus);
      rowElement(step.focus)?.focus();
    }
    if (step.expand !== undefined) onToggleDir(step.expand);
    if (step.collapse !== undefined) onToggleDir(step.collapse);
  };

  // The one row in the tab order. A focused row that scrolled out of the rows (its
  // directory closed) hands the stop back to the selection or the first row.
  const onScreen = (path: string | null): boolean =>
    path !== null && rows.some((r) => r.path === path);
  const tabStop = onScreen(focused)
    ? focused
    : onScreen(selectedPath)
      ? selectedPath
      : (rows[0]?.path ?? null);

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label={S.files.treeLabel}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto py-1"
    >
      {rows.length === 0 ? (
        rootEmpty ? (
          <p className="px-3 py-2 text-sm text-gray-400">{S.files.empty}</p>
        ) : null
      ) : (
        rows.map((row) => {
          const selected =
            row.path === selectedPath ||
            (selectedPath === null && row.kind === "dir" && row.path === currentDir);
          const dropHere = row.kind === "dir" && row.path === dropTargetDir;
          const loading = row.kind === "dir" && loadingDirs.has(row.path);
          const detail =
            row.kind === "file"
              ? `${row.path} · ${formatBytes(row.sizeBytes)} · ${formatDateTime(row.mtime)}`
              : row.path;
          return (
            <div key={row.path}>
              <div
                role="treeitem"
                tabIndex={row.path === tabStop ? 0 : -1}
                aria-level={row.depth + 1}
                aria-selected={selected}
                {...(row.kind === "dir" ? { "aria-expanded": row.expanded } : {})}
                aria-busy={loading || undefined}
                data-tree-path={row.path}
                data-tree-kind={row.kind}
                title={detail}
                onClick={() => activate(row)}
                onFocus={() => setFocused(row.path)}
                style={{ paddingLeft: 6 + row.depth * INDENT_PX }}
                className={`flex cursor-pointer select-none items-center gap-1.5 py-1 pr-2 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/60 ${
                  dropHere
                    ? "bg-sky-50 ring-2 ring-inset ring-sky-500/60 dark:bg-sky-950/40"
                    : selected
                      ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                      : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
                } ${loading ? "opacity-60" : ""}`}
              >
                <span className="flex w-3.5 shrink-0 justify-center text-gray-400" aria-hidden>
                  {row.kind === "dir" && (
                    <Chevron open={row.expanded} size={ICON_SIZE.chevronDense} />
                  )}
                </span>
                <GlyphIcon
                  d={
                    row.kind === "dir" ? (row.expanded ? FOLDER_OPEN_ICON : FOLDER_ICON) : FILE_ICON
                  }
                  size={ICON_SIZE.rowLead}
                  className="text-gray-400"
                />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {row.kind === "file" && (
                  <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">
                    {formatBytes(row.sizeBytes)}
                  </span>
                )}
              </div>
              {/* An open directory with nothing in it says so, in place of the children it lacks. */}
              {row.kind === "dir" && row.expanded && row.empty && (
                <p
                  className="py-1 pr-2 text-xs text-gray-400"
                  style={{ paddingLeft: 6 + (row.depth + 1) * INDENT_PX + 14 }}
                >
                  {S.files.empty}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
