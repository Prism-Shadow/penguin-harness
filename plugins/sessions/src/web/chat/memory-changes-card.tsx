import { S } from "@prismshadow/penguin-web/internal";
import { type MemoryChangeRow, memoryRowKey } from "@prismshadow/penguin-web/internal";


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
          ...(onLocateChange ? { tooltip: row.file, onOpen: () => onLocateChange(row) } : {}),
        };
      })}
      openHint={S.chat.memoryRowOpen}
      showMore={S.chat.memoryShowMore}
      showLess={S.chat.showLess}
    />
  );
}
