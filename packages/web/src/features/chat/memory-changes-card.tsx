/**
 * Memory-change summary card, rendered right below the file-summary card at the end of a
 * root Task (the same card, the UI package's ChangesCard): one row per memory topic file the
 * Task changed through the structured file tools, derived by the stream model
 * (TaskStatsItem.memoryChanges — see lib/omni/memory-changes.ts for what qualifies and what is
 * filtered).
 *
 * Clicking a row opens the Memory side panel directly on that memory's content; the header's
 * "Open memory list" text action opens the panel on its list. The action is words, in the rows'
 * own "View content" hint style: a brain glyph there would only repeat the card's own mark beside
 * it, and say nothing of where it leads. A changed file that was deleted in a later turn is
 * filtered out (deletedKeys) — the row disappears here just as it does from the panel's list;
 * the whole card hides when nothing survives.
 */
import { ChangesCard, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";
import { scopeGlyph } from "./memory-view";

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
  /** Header text action: open the Memory panel on its list; the action doesn't render if this isn't wired up. */
  onOpenPanel?: () => void;
}) {
  const alive = deletedKeys ? rows.filter((row) => !deletedKeys.has(memoryRowKey(row))) : rows;
  if (alive.length === 0) return null;

  return (
    <ChangesCard
      glyph={ICONS.brain}
      title={S.chat.memoryChangesTitle(alive.length)}
      {...(onOpenPanel ? { action: { label: S.chat.memoryOpenList, onClick: onOpenPanel } } : {})}
      rows={alive.map((row) => {
        const scope = scopeGlyph(row.scope, row.scopeKey);
        return {
          id: memoryRowKey(row),
          path: row.file,
          glyph: scope.d,
          glyphLabel: scope.title,
          mark:
            row.op === "write"
              ? { glyph: ICONS.filePlus, label: S.chat.memoryOpWrite }
              : { glyph: ICONS.penLine, label: S.chat.memoryOpEdit },
          ...(onLocateChange
            ? { tooltip: S.chat.memoryRowOpen, onOpen: () => onLocateChange(row) }
            : {}),
        };
      })}
      openHint={S.chat.memoryRowOpen}
      showMore={S.chat.memoryShowMore}
      showLess={S.chat.showLess}
    />
  );
}
