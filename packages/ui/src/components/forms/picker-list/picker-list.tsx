/**
 * A search box over a keyboard-walkable list: the candidate panel a picker opens (the model
 * dropdown, the in-session model switch, the agent handoff picker). The search box, the internal
 * scroll cap, the row chrome, the keyboard navigation and the "current entry" check all live here,
 * so the pickers built on it differ only in what a row *contains* (a provider logo, an agent
 * avatar) and in what they hang below the list (`footer`, e.g. a "show all" expander).
 *
 * Keyboard navigation deliberately starts with **no** row highlighted: the search box is
 * autofocused, and pre-highlighting a row would repaint a panel that has looked the same since
 * before this control existed. ArrowDown/ArrowUp begin the navigation, and Enter/Tab commits — the
 * highlighted row if there is one, otherwise the top match, which is what makes "type a few
 * letters, press Enter" work. Escape is the host's: the search box empties itself on the first
 * press when it holds text, and the host closes its own panel at the window level (an IME-safe
 * handler for a switch picker, the dropdown's for a dropdown).
 */
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChoiceCheck, menuRowClass, menuRowTone } from "../../overlays/menu-panel/menu-panel";
import { SearchInput } from "../search-input/search-input";

export function PickerList<T>({
  items,
  itemKey,
  isCurrent,
  query,
  onQueryChange,
  searchPlaceholder,
  emptyText,
  onPick,
  renderRow,
  footer,
}: {
  items: readonly T[];
  /** Stable React key AND identity for the highlighted row. */
  itemKey: (item: T) => string;
  /** Marks the entry already in effect: renders the check and the current row's fill. */
  isCurrent?: (item: T) => boolean;
  query: string;
  onQueryChange: (query: string) => void;
  /** The search box's placeholder, which is also its accessible name. */
  searchPlaceholder: string;
  /** Shown in place of the list when the query matches nothing. */
  emptyText: string;
  onPick: (item: T) => void;
  /** The row's own content, left of the check's slot. */
  renderRow: (item: T) => ReactNode;
  /** Pinned below the scroll area (mirroring the search box above it). */
  footer?: ReactNode;
}) {
  // -1 = nothing highlighted yet (see the note above); reset whenever the query changes.
  const [active, setActive] = useState(-1);
  const activeKey = active >= 0 && active < items.length ? itemKey(items[active]!) : null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return;
    }
    // An IME commit must not be read as a pick.
    if (((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onPick(items[active >= 0 ? active : 0]!);
    }
  };
  return (
    <div className="contents" onKeyDown={onKeyDown}>
      {/* Quick search (autofocused: it also owns the keyboard while the panel is up) */}
      <div className="border-b border-line-muted px-2 pb-1.5 pt-0.5">
        <SearchInput
          variant="menu"
          autoFocus
          value={query}
          onChange={(next) => {
            onQueryChange(next);
            setActive(-1);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {items.length === 0 && <p className="px-3 py-1.5 text-xs text-fg-subtle">{emptyText}</p>}
        {items.map((item) => {
          const key = itemKey(item);
          const current = isCurrent?.(item) ?? false;
          return (
            <button
              key={key}
              type="button"
              ref={key === activeKey ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onClick={() => onPick(item)}
              className={`flex items-center gap-2 ${menuRowClass} text-xs ${menuRowTone(current)}${
                key === activeKey ? " bg-line-muted" : ""
              }`}
            >
              {renderRow(item)}
              <ChoiceCheck on={current} />
            </button>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
