/**
 * Memory-change summary card, rendered right below the file-summary card at the end of a
 * root Task (same visual family): one row per memory topic file the Task changed through
 * the structured file tools, derived by the stream model (TaskStatsItem.memoryChanges —
 * see lib/omni/memory-changes.ts for what qualifies and what is filtered).
 *
 * Clicking a row opens the Memory side panel directly on that memory's content; the
 * header's book button opens the panel on its list. A changed file that was deleted in a
 * later turn is filtered out (deletedKeys) — the row disappears here just as it does from
 * the panel's list; the whole card hides when nothing survives.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Chevron } from "../../components/ui/chevron";
import { ICON_SIZE } from "../../lib/icon-scale";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";
import { PathLabel } from "./message-files-card";
import { FILE_EDIT_ICON, FILE_WRITE_ICON } from "../../components/ui/icons";
import { scopeGlyph } from "./memory-view";

const MAX_VISIBLE = 3;

/** Open book: the card's mark, same as the Memory panel's. */
const MEMORY_ICON =
  "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z";

export function MemoryChangesCard({
  rows,
  deletedKeys,
  onLocateChange,
  onOpenPanel,
}: {
  rows: MemoryChangeRow[];
  /** Keys (memoryRowKey) of changed files that no longer exist: those rows are filtered out. Absent = the listing hasn't loaded, which must not read as deleted — everything shows. */
  deletedKeys?: ReadonlySet<string>;
  /** Row click: open the Memory panel on this row's content; rows render as plain rows if this isn't wired up. */
  onLocateChange?: (row: MemoryChangeRow) => void;
  /** Header button: open the Memory panel on its list; the button doesn't render if this isn't wired up. */
  onOpenPanel?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const alive = deletedKeys ? rows.filter((row) => !deletedKeys.has(memoryRowKey(row))) : rows;
  if (alive.length === 0) return null;

  const visible = expanded ? alive : alive.slice(0, MAX_VISIBLE);
  const hidden = alive.length - visible.length;

  const rowInner = (row: MemoryChangeRow) => {
    const glyph = scopeGlyph(row.scope, row.scopeKey);
    return (
      <>
        <span title={glyph.title} className="shrink-0 text-gray-400">
          <GlyphIcon d={glyph.d} size={ICON_SIZE.rowLead} />
          <span className="sr-only">{glyph.title}</span>
        </span>
        <PathLabel path={row.file} />
        <span className="min-w-0 flex-1" />
        <span
          title={row.op === "write" ? S.chat.memoryOpWrite : S.chat.memoryOpEdit}
          className="shrink-0 text-gray-400"
        >
          <GlyphIcon
            d={row.op === "write" ? FILE_WRITE_ICON : FILE_EDIT_ICON}
            size={ICON_SIZE.inlineGlyph}
          />
        </span>
      </>
    );
  };

  return (
    <div className="anim-msg my-3 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Header bar, mirroring the file-summary card: "icon + N memory updates", plus the one
          card-level action (rows navigate to their own content, so this doesn't duplicate them). */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800/60 dark:bg-gray-800/40">
        <GlyphIcon d={MEMORY_ICON} size={ICON_SIZE.rowLead} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {S.chat.memoryChangesTitle(alive.length)}
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
          return onLocateChange ? (
            <button
              key={key}
              type="button"
              title={S.chat.memoryRowOpen}
              onClick={() => onLocateChange(row)}
              className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              {rowInner(row)}
              {/* Right-aligned action hint, the file card's affordance (span, not a nested button: the row itself is the button). */}
              <span
                aria-hidden
                className="shrink-0 text-xs text-gray-400 transition-colors duration-150 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300"
              >
                {S.chat.memoryRowOpen}
              </span>
            </button>
          ) : (
            <div key={key} className="flex w-full items-center gap-2 px-3 py-2">
              {rowInner(row)}
            </div>
          );
        })}
        {(hidden > 0 || expanded) && alive.length > MAX_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50"
          >
            {expanded ? S.chat.showLess : S.chat.memoryShowMore(hidden)}
            <Chevron open={expanded} className="text-gray-400" size={ICON_SIZE.chevronDense} />
          </button>
        )}
      </div>
    </div>
  );
}
