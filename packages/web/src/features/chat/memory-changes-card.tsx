/**
 * Memory-change summary card, rendered right below the file-summary card at the end of a
 * root Task (same visual family): one row per memory topic file the Task changed through
 * the structured file tools, derived by the stream model (TaskStatsItem.memoryChanges —
 * see lib/omni/memory-changes.ts for what qualifies and what is filtered).
 *
 * Clicking a row opens the side panel's Memory view located at that row — expanded on its
 * per-call diffs; the header's book button opens the same view unlocated. Memory lives
 * outside the Workspace, so the Files panel's tree/preview can't show these files — the
 * Memory view is their in-chat home.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Chevron } from "../../components/ui/chevron";
import { ICON_SIZE } from "../../lib/icon-scale";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";
import { PathLabel } from "./message-files-card";
import { scopeGlyph } from "./memory-view";

const MAX_VISIBLE = 3;

/** Open book (the card's mark, same as the panel's Memory toggle), page-with-plus (full write), pencil (in-place edit). */
const MEMORY_ICON =
  "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z";
const WRITE_ICON = "M6 3h8l4 4v14H6zM12 11v6M9 14h6";
const EDIT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";

/** Trash can (the memory-tab's delete glyph): the deleted-row marker. */
const TRASH_ICON =
  "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6";

export function MemoryChangesCard({
  rows,
  deletedKeys,
  onLocateChange,
  onOpenPanel,
}: {
  rows: MemoryChangeRow[];
  /** Keys (memoryRowKey) of changed files that no longer exist: their rows render unopenable with a deleted marker. Absent = the listing hasn't loaded, which must not read as deleted. */
  deletedKeys?: ReadonlySet<string>;
  /** Row click: open the side panel's Memory view located at this row's diffs; rows render as plain rows if this isn't wired up. */
  onLocateChange?: (row: MemoryChangeRow) => void;
  /** Header button: open the Memory view unlocated; the button doesn't render if this isn't wired up. */
  onOpenPanel?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const visible = expanded ? rows : rows.slice(0, MAX_VISIBLE);
  const hidden = rows.length - visible.length;

  const rowInner = (row: MemoryChangeRow, deleted: boolean) => {
    const glyph = scopeGlyph(row.scope, row.scopeKey);
    return (
      <>
        <span title={glyph.title} className="shrink-0 text-gray-400">
          <GlyphIcon d={glyph.d} size={ICON_SIZE.rowLead} />
          <span className="sr-only">{glyph.title}</span>
        </span>
        <span className={deleted ? "min-w-0 line-through opacity-60" : "contents"}>
          <PathLabel path={row.file} />
        </span>
        <span className="min-w-0 flex-1" />
        {deleted ? (
          <span title={S.chat.memoryDeleted} className="shrink-0 text-gray-400">
            <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.inlineGlyph} />
            <span className="sr-only">{S.chat.memoryDeleted}</span>
          </span>
        ) : (
          <span
            title={row.op === "write" ? S.chat.memoryOpWrite : S.chat.memoryOpEdit}
            className="shrink-0 text-gray-400"
          >
            <GlyphIcon
              d={row.op === "write" ? WRITE_ICON : EDIT_ICON}
              size={ICON_SIZE.inlineGlyph}
            />
          </span>
        )}
      </>
    );
  };

  return (
    <div className="anim-msg my-3 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Header bar, mirroring the file-summary card: "icon + N memory updates", plus the one
          card-level action (rows navigate to their own diff, so this doesn't duplicate them). */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800/60 dark:bg-gray-800/40">
        <GlyphIcon d={MEMORY_ICON} size={ICON_SIZE.rowLead} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {S.chat.memoryChangesTitle(rows.length)}
        </span>
        {onOpenPanel && (
          <button
            type="button"
            title={S.chat.memoryViewTitle}
            onClick={onOpenPanel}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <GlyphIcon d={MEMORY_ICON} size={ICON_SIZE.inlineGlyph} />
            <span className="sr-only">{S.chat.memoryViewTitle}</span>
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
        {visible.map((row) => {
          const key = memoryRowKey(row);
          const deleted = deletedKeys?.has(key) === true;
          return !deleted && onLocateChange ? (
            <button
              key={key}
              type="button"
              title={S.chat.memoryRowOpen}
              onClick={() => onLocateChange(row)}
              className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              {rowInner(row, false)}
              {/* Right-aligned action hint, the file card's affordance (span, not a nested button: the row itself is the button). */}
              <span
                aria-hidden
                className="shrink-0 text-xs text-gray-400 transition-colors duration-150 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300"
              >
                {S.chat.memoryRowOpen}
              </span>
            </button>
          ) : (
            // Deleted (or handler-less) rows keep their place but never open — a click
            // would only land on a 404 detail.
            <div key={key} className="flex w-full items-center gap-2 px-3 py-2">
              {rowInner(row, deleted)}
            </div>
          );
        })}
        {(hidden > 0 || expanded) && rows.length > MAX_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50"
          >
            {expanded ? S.chat.showLess : S.chat.memoryShowMore(hidden)}
            <Chevron open={expanded} className="text-gray-400" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
