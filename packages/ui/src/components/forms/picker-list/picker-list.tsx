/**
 * A search box over a keyboard-walkable list: the candidate panel a picker opens (the agent
 * handoff picker, the schedule form's session picker; the model picker grew into a dialog of its
 * own). The search box, the internal scroll cap, the row chrome, the keyboard navigation and the
 * "current entry" check all live here, so the pickers built on it differ only in what a row
 * *contains* (an agent avatar, a session title) and in what they hang below the list (`footer`,
 * e.g. a "show all" expander).
 *
 * Keyboard navigation deliberately starts with **no** row highlighted: the search box is
 * autofocused, and pre-highlighting a row would repaint a panel that has looked the same since
 * before this control existed. ArrowDown/ArrowUp begin the navigation, and Enter/Tab commits — the
 * highlighted row if there is one, otherwise the top match, which is what makes "type a few
 * letters, press Enter" work. Escape is the host's: the search box empties itself on the first
 * press when it holds text, and the host closes its own panel at the window level (an IME-safe
 * handler for a switch picker, the dropdown's for a dropdown).
 *
 * A host whose items fall into runs (the agent picker's company employees, listed last) names
 * a run with `groupLabel`: the name is drawn once above the run's first row, in the menus'
 * group-label rung. It is not a row — the keyboard walks the items alone.
 */
import { Fragment, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { MenuLabel } from "../../overlays/menu/menu";
import { ChoiceCheck, menuRowClass, menuRowTone } from "../../overlays/menu-panel/menu-panel";
import { SearchInput } from "../search-input/search-input";
import { Modal } from "../../overlays/modal/modal";
import { CloseButton } from "../../actions/close-button/close-button";

export interface PickerListProps<T> {
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
  /** The name of the run an item belongs to, drawn above the run's first row; null = no name. */
  groupLabel?: (item: T) => string | null;
  /** Pinned below the scroll area (mirroring the search box above it). */
  footer?: ReactNode;
  /** Dialog rows have more room and a viewport-bounded list; menus keep their compact cap. */
  layout?: "menu" | "dialog";
  /** Optional controls beside the search, such as a dialog close button. */
  searchActions?: ReactNode;
}

/** A compact searchable choice dialog, sharing row and keyboard behavior with menu pickers. */
export function PickerDialog<T>({
  open,
  onClose,
  title,
  ...picker
}: Omit<PickerListProps<T>, "layout" | "searchActions"> & {
  open: boolean;
  onClose: () => void;
  title: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} headerless bare widthClass="sm:max-w-md">
      <PickerList {...picker} layout="dialog" searchActions={<CloseButton onClose={onClose} />} />
    </Modal>
  );
}

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
  groupLabel,
  footer,
  layout = "menu",
  searchActions,
}: PickerListProps<T>) {
  // -1 = nothing highlighted yet (see the note above); reset whenever the query changes.
  const [active, setActive] = useState(-1);
  const activeKey = active >= 0 && active < items.length ? itemKey(items[active]!) : null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A focused row or header action keeps the button's own Enter/Space behavior.
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;
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
      <div
        className={`flex items-center gap-2 border-b border-line-muted ${layout === "dialog" ? "px-3 py-2.5" : "px-2 pb-1.5 pt-0.5"}`}
      >
        <SearchInput
          className="min-w-0 flex-1"
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
        {searchActions}
      </div>
      <div
        className={
          layout === "dialog"
            ? "max-h-[min(22rem,60dvh)] overflow-y-auto p-1.5"
            : "max-h-56 overflow-y-auto"
        }
      >
        {items.length === 0 && <p className="px-3 py-1.5 text-xs text-fg-subtle">{emptyText}</p>}
        {items.map((item, i) => {
          const key = itemKey(item);
          const current = isCurrent?.(item) ?? false;
          const label = groupLabel?.(item) ?? null;
          const opensRun = label !== null && (i === 0 || groupLabel?.(items[i - 1]!) !== label);
          return (
            <Fragment key={key}>
              {opensRun && <MenuLabel>{label}</MenuLabel>}
              <button
                type="button"
                ref={
                  key === activeKey ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined
                }
                onClick={() => onPick(item)}
                aria-pressed={current}
                className={`flex items-center gap-2 ${layout === "dialog" ? "w-full rounded-md px-2 py-2 text-left text-sm transition-colors" : `${menuRowClass} text-xs`} ${menuRowTone(current)}${
                  key === activeKey ? " bg-line-muted" : ""
                }`}
              >
                {renderRow(item)}
                <ChoiceCheck on={current} />
              </button>
            </Fragment>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
