/**
 * Actions on a sidebar Session row, and the two surfaces that offer them.
 *
 * The row carries a **pared-back hover affordance** and a **full context menu**, and this
 * module owns which actions belong to each so the two cannot drift:
 *
 * - Hovering a row reveals archive as a direct icon button plus an ellipsis "more"
 *   button that opens the context menu anchored at itself. The menu grew configuration
 *   actions (messaging binding) that right-click alone left undiscoverable, so the
 *   pointer entry is the ellipsis; delete moved inside the menu with them (still
 *   danger-styled there), keeping the hover surface to one safe direct action.
 * - Right-clicking a row (or holding it on touch, Shift+F10 on the keyboard, or clicking
 *   the ellipsis) opens the whole set — pin, rename, messaging, archive, copy id, delete —
 *   as a labelled menu.
 *
 * Rename therefore keeps a home: every Session must stay renamable, archivable and
 * deletable, and paring the hover affordance down would otherwise have dropped rename
 * off the row entirely.
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import { GlyphIcon, ICONS, menuRowClass, menuRowTone } from "@prismshadow/penguin-ui";
import type { AnchorRect } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { Icon } from "./group-list";

/** Compact overflow-menu row (session row menu + workspace group menu): small text, leading thin-line glyph. */
export const overflowMenuRowClass = `flex items-center gap-2 ${menuRowClass} text-xs ${menuRowTone()}`;

/** The overflow menus' destructive row (delete keeps the red treatment; its glyph inherits the red). */
export const overflowMenuDangerClass = `flex items-center gap-2 ${menuRowClass} text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40`;

/**
 * A menu row's leading glyph. It names the row's subject beside a label that is never dropped,
 * so it is decorative (`ui-icon-decor`, role `menu`): a theme may recolour it or leave it out.
 * Muted, except on a danger row, where it inherits the row's red.
 */
export function MenuItemGlyph({ d, danger = false }: { d: string; danger?: boolean }) {
  return (
    <span
      className={`ui-icon-decor shrink-0 ${danger ? "" : "text-gray-400 dark:text-gray-500"}`}
      data-role="menu"
    >
      <Icon d={d} size={13} />
    </span>
  );
}

/** The overflow menus' muted leading glyph, for call sites that build their rows inline. */
export const overflowMenuGlyph = (d: string) => <MenuItemGlyph d={d} />;

/** One thing a Session row can do to its Session. */
export type SessionRowAction = "pin" | "rename" | "copy" | "messaging" | "archive" | "delete";

/** Row state the labels and glyphs read (both of the toggles flip on it). */
export interface SessionRowState {
  archived: boolean;
  pinned: boolean;
}

/**
 * The hover affordance's direct actions: archive alone. Everything else — delete
 * included — lives in the context menu, whose discoverable pointer entry is the
 * ellipsis button `SessionRowHoverActions` renders after these (see the module header).
 */
export const HOVER_ROW_ACTIONS: readonly SessionRowAction[] = ["archive"];

/**
 * The context menu's actions. Pin only reorders rows in the active list, so folder rows
 * (archived / subagent / scheduled) offer the rest without it — the same gate the
 * ellipsis menu applied before this moved. The order runs from the actions that change
 * the Session to the one that ends it: pin, rename and the messaging binding first, then
 * archive, then copying the id — the one row that changes nothing, kept between archive
 * and delete — and delete last.
 */
export function contextMenuActions(canPin: boolean): readonly SessionRowAction[] {
  return canPin
    ? ["pin", "rename", "messaging", "archive", "copy", "delete"]
    : ["rename", "messaging", "archive", "copy", "delete"];
}

/**
 * A company desk row's menu (features/company/org-session-groups.tsx). A desk's title and its
 * lifecycle belong to the organization — the employee names it, hiring and firing open and
 * close it — so rename, archive, delete and pin are not its reader's to run. What is left is
 * which Session this is and what it is bound to.
 */
export const DESK_ROW_ACTIONS: readonly SessionRowAction[] = ["copy", "messaging"];

export interface SessionRowMenuItem {
  /** Label in the action's current state, and the icon-only buttons' accessible name. */
  label: string;
  icon: string;
  /** Destructive: red row in the menu, red hover on the icon button. */
  danger: boolean;
}

/** Label + glyph for one action, given the state of the row it sits on. */
export function sessionRowMenuItem(
  action: SessionRowAction,
  state: SessionRowState,
): SessionRowMenuItem {
  switch (action) {
    case "pin":
      return {
        label: state.pinned ? S.chat.unpinSession : S.chat.pinSession,
        icon: ICONS.pin,
        danger: false,
      };
    case "rename":
      return { label: S.chat.renameSession, icon: ICONS.pencil, danger: false };
    case "copy":
      // The same glyph and label the details card's Session id row carries: one copy
      // affordance for one value, wherever the reader meets it.
      return { label: S.chat.copySessionId, icon: ICONS.copy, danger: false };
    case "messaging":
      // Same paper plane the session row flies when it is actually relaying: the menu entry
      // and the mark it produces are one feature, and a reader should not have to learn two
      // shapes for it.
      return { label: S.messaging.bindAction, icon: ICONS.paperPlane, danger: false };
    case "archive":
      return {
        label: state.archived ? S.chat.unarchiveSession : S.chat.archiveSession,
        icon: state.archived ? ICONS.archiveRestore : ICONS.archive,
        danger: false,
      };
    case "delete":
      return { label: S.chat.deleteSession, icon: ICONS.trash, danger: true };
  }
}

/** The context menu's body: one labelled row per action, in the given order. */
export function SessionRowMenuRows({
  actions,
  state,
  onRun,
}: {
  actions: readonly SessionRowAction[];
  state: SessionRowState;
  onRun: (action: SessionRowAction) => void;
}) {
  return (
    <>
      {actions.map((action) => {
        const item = sessionRowMenuItem(action, state);
        return (
          <button
            key={action}
            type="button"
            className={item.danger ? overflowMenuDangerClass : overflowMenuRowClass}
            onClick={() => onRun(action)}
          >
            <MenuItemGlyph d={item.icon} danger={item.danger} />
            {item.label}
          </button>
        );
      })}
    </>
  );
}

/** The hover buttons' shared reveal classes (see SessionRowHoverActions on why pointer events are gated with opacity). */
const hoverButtonClass =
  "pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-all duration-150 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100";

/**
 * Hover affordance: icon-only buttons that fade in over the row — the direct actions
 * (archive), then an ellipsis that opens the row's context menu anchored at itself, so
 * every menu action is one visible click away rather than right-click-only. Deliberately
 * hover/focus-gated and therefore desktop-only — Tailwind scopes `hover:` behind
 * `@media (hover: hover)`, so these never appear on a touch screen, where the same menu
 * is reached by holding the row instead.
 *
 * Which is why they are **pointer-events-gated on exactly the same conditions as their
 * opacity**, not just faded out: an invisible button still takes taps, so a bare
 * `opacity-0` would leave a phantom tap target sitting over the right end of every row
 * for the one class of user who can never see it. Keyboard focus is unaffected by
 * `pointer-events`, so Tab still reaches them and revealing them re-arms the click.
 */
export function SessionRowHoverActions({
  actions,
  state,
  onRun,
  onMore,
}: {
  actions: readonly SessionRowAction[];
  state: SessionRowState;
  onRun: (action: SessionRowAction) => void;
  /** Opens the row's context menu anchored at the ellipsis button's own box. */
  onMore: (anchor: AnchorRect) => void;
}) {
  const openMore = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMore({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  };
  return (
    <>
      {actions.map((action) => {
        const item = sessionRowMenuItem(action, state);
        return (
          <button
            key={action}
            type="button"
            data-tooltip={item.label}
            aria-label={item.label}
            onClick={() => onRun(action)}
            className={`${hoverButtonClass} ${
              item.danger
                ? "hover:text-red-600 dark:hover:text-red-400"
                : "hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
            }`}
          >
            <Icon d={item.icon} size={14} />
          </button>
        );
      })}
      <button
        type="button"
        data-tooltip={S.chat.moreActions}
        aria-label={S.chat.moreActions}
        aria-haspopup="menu"
        onClick={openMore}
        className={`${hoverButtonClass} hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200`}
      >
        {/* Hairline-stroke dots vanish at row-glyph size, so the ellipsis is drawn filled: the
            stroke rides on top of the fill, landing the dots at the archive glyph's weight. */}
        <GlyphIcon d={ICONS.ellipsis} size={14} filled />
      </button>
    </>
  );
}
