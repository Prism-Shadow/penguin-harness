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
 *
 * The rows stay one flat list; what nests is the drawing. An open directory's descendants go
 * in a `role="group"` box whose height is animated, so a subtree grows out of its directory's
 * row and shrinks back into it. Only the directory the panel says was just toggled animates,
 * so a re-render, a filter or an unrelated commit animates nothing. Closing is the awkward
 * half: the rows are gone from `rows` by the time the view hears about it, so the view keeps
 * the last committed rows and re-renders the closed directory's own descendants, inert, for
 * as long as the shrink lasts.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { S } from "../../lib/strings";
import { formatBytes, formatDateTime } from "../../lib/format";
import { subtreeEnd, treeKeyStep } from "../../lib/workspace-tree";
import type { TreeRow } from "../../lib/workspace-tree";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON, FOLDER_OPEN_ICON } from "../../components/ui/group-list";
import { ICON_SIZE } from "../../lib/icon-scale";
import { FILE_ICON } from "../../components/ui/icons";

/** Indent per nesting level, in px. */
const INDENT_PX = 14;

/**
 * How long a closing subtree is kept on screen when its animation never reports back. Under
 * `prefers-reduced-motion` the keyframes are off, so no `animationend` ever arrives and this
 * timer is the only thing that drops the retained rows. Comfortably past the 200ms shrink.
 */
const CLOSE_FALLBACK_MS = 260;

/** The directory whose open or close the tree should animate. `serial` makes toggling the same directory again a new event. */
export interface TreeToggle {
  dir: string;
  open: boolean;
  serial: number;
}

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  // The descendants of directories that have just closed, by directory path. They are no
  // longer in `rows` — the panel closed the directory in the same commit that reported the
  // toggle — so they are captured from the previous commit's rows and drawn until the shrink
  // is over. They are never in `rows`, and so never in treeKeyStep, the tab stop or onScreen.
  const [closing, setClosing] = useState<ReadonlyMap<string, readonly TreeRow[]>>(() => new Map());
  // The serial of the toggle already acted on. The serial, not the object: a filter hands the
  // prop null and then hands the very same toggle back when it is cleared, and replaying that
  // close would shrink a ghost subtree out of a directory the user never touched.
  const [seenSerial, setSeenSerial] = useState<number>(toggled?.serial ?? 0);
  const prevRowsRef = useRef<readonly TreeRow[]>(rows);

  if (toggled === null) {
    // A filter redraws the tree from a different row set; nothing left over belongs to it.
    if (closing.size > 0) setClosing(new Map());
  } else if (toggled.serial !== seenSerial) {
    // Adjusting state during render rather than in an effect: the retained rows have to be in
    // the same paint that dropped them, or the subtree blinks out and then shrinks from nothing.
    setSeenSerial(toggled.serial);
    if (toggled.open) {
      // Re-opened while shrinking: the live group takes over, animating open from where it is.
      if (closing.has(toggled.dir)) {
        const next = new Map(closing);
        next.delete(toggled.dir);
        setClosing(next);
      }
    } else {
      const prev = prevRowsRef.current;
      const at = prev.findIndex((r) => r.path === toggled.dir);
      const kept = at < 0 ? [] : prev.slice(at + 1, subtreeEnd(prev, at));
      if (kept.length > 0) setClosing(new Map(closing).set(toggled.dir, kept));
    }
  }

  useEffect(() => {
    prevRowsRef.current = rows;
  }, [rows]);

  const dropClosing = (dir: string): void => {
    setClosing((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Map(prev);
      next.delete(dir);
      return next;
    });
  };

  useEffect(() => {
    if (closing.size === 0) return;
    const timers = [...closing.keys()].map((dir) =>
      setTimeout(() => dropClosing(dir), CLOSE_FALLBACK_MS),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [closing]);

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

  /** One row. A retained row is a leftover of a closing subtree: it draws, and does nothing else. */
  const renderRow = (row: TreeRow, retained: boolean): ReactNode => {
    const selected =
      !retained &&
      (row.path === selectedPath ||
        (selectedPath === null && row.kind === "dir" && row.path === currentDir));
    const dropHere = !retained && row.kind === "dir" && row.path === dropTargetDir;
    const loading = row.kind === "dir" && loadingDirs.has(row.path);
    const detail =
      row.kind === "file"
        ? `${row.path} · ${formatBytes(row.sizeBytes)} · ${formatDateTime(row.mtime)}`
        : row.path;
    return (
      <div
        key={row.path}
        role="treeitem"
        tabIndex={retained || row.path !== tabStop ? -1 : 0}
        aria-level={row.depth + 1}
        aria-posinset={row.posInSet}
        aria-setsize={row.setSize}
        aria-selected={selected}
        {...(row.kind === "dir" ? { "aria-expanded": row.expanded } : {})}
        aria-busy={loading || undefined}
        // A retained row carries no path: rowElement() and the drop hit test both resolve a
        // row by this attribute, and neither may land on one that is on its way out.
        {...(retained ? {} : { "data-tree-path": row.path, "data-tree-kind": row.kind })}
        title={detail}
        {...(retained ? {} : { onClick: () => activate(row), onFocus: () => setFocused(row.path) })}
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
          {row.kind === "dir" && <Chevron open={row.expanded} size={ICON_SIZE.chevronDense} />}
        </span>
        <GlyphIcon
          d={row.kind === "dir" ? (row.expanded ? FOLDER_OPEN_ICON : FOLDER_ICON) : FILE_ICON}
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
    );
  };

  /** An open directory with nothing in it says so, in place of the children it lacks. */
  const renderEmptyLine = (row: TreeRow): ReactNode => (
    <p
      key={`empty:${row.path}`}
      className="py-1 pr-2 text-xs text-gray-400"
      style={{ paddingLeft: 6 + (row.depth + 1) * INDENT_PX + 14 }}
    >
      {S.files.empty}
    </p>
  );

  /**
   * The rows of `list` in `[start, end)`, with each open directory's descendants nested in a
   * group below it. `retained` marks a closing subtree, which draws its own nested groups but
   * animates nothing and takes no part in interaction.
   */
  const renderRange = (
    list: readonly TreeRow[],
    start: number,
    end: number,
    retained: boolean,
  ): ReactNode[] => {
    const out: ReactNode[] = [];
    let i = start;
    while (i < end) {
      const row = list[i]!;
      out.push(renderRow(row, retained));
      if (row.kind !== "dir") {
        i += 1;
        continue;
      }
      const childrenEnd = subtreeEnd(list, i);
      if (row.expanded && row.loaded) {
        // The group mounts only once the listing is there, so a first open of an unloaded
        // directory animates when its rows arrive rather than around an empty box.
        const opening = !retained && toggled !== null && toggled.open && toggled.dir === row.path;
        out.push(
          <div
            key={`group:${row.path}`}
            role="group"
            aria-label={row.name}
            className={`tree-group ${opening ? "tree-group-open" : ""}`}
          >
            <div>
              {row.empty ? renderEmptyLine(row) : renderRange(list, i + 1, childrenEnd, retained)}
            </div>
          </div>,
        );
      } else if (!retained && closing.has(row.path)) {
        const kept = closing.get(row.path)!;
        out.push(
          <div
            key={`closing:${row.path}`}
            role="group"
            aria-hidden
            inert
            className="tree-group tree-group-close"
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) dropClosing(row.path);
            }}
          >
            <div>{renderRange(kept, 0, kept.length, true)}</div>
          </div>,
        );
      }
      i = childrenEnd;
    }
    return out;
  };

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label={S.files.treeLabel}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto py-1"
    >
      {rows.length === 0 ? (
        filtering ? (
          <p className="px-3 py-2 text-sm text-gray-400">{S.files.searchNoMatch}</p>
        ) : rootEmpty ? (
          <p className="px-3 py-2 text-sm text-gray-400">{S.files.empty}</p>
        ) : null
      ) : (
        // `role="group"` is the tree pattern's own container for one level, so the rows inside
        // one are still `treeitem`s of this tree and keep stating their own aria-level,
        // aria-posinset and aria-setsize.
        renderRange(rows, 0, rows.length, false)
      )}
    </div>
  );
}
