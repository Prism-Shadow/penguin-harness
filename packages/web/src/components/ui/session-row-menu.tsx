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
 *
 * The surfaces themselves are the UI package's (`SessionRow`, `RowHoverActions`, the `MenuItem`
 * rows); this module says which actions they carry and in what words.
 */
import { ICONS, MenuItem, RowHoverActions } from "@prismshadow/penguin-ui";
import type { AnchorRect, RowActionItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

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
 * ellipsis button the row renders after these (see the module header).
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

/**
 * The given actions as the package row's items: each with its label and glyph for the row's
 * state, and `run` as what choosing it does.
 */
export function sessionRowActions(
  actions: readonly SessionRowAction[],
  state: SessionRowState,
  run: (action: SessionRowAction) => void,
): RowActionItem[] {
  return actions.map((action) => {
    const item = sessionRowMenuItem(action, state);
    return {
      id: action,
      label: item.label,
      glyph: item.icon,
      danger: item.danger,
      onSelect: () => run(action),
    };
  });
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
      {sessionRowActions(actions, state, onRun).map((item) => (
        <MenuItem
          key={item.id}
          density="sm"
          glyph={item.glyph}
          label={item.label}
          danger={item.danger === true}
          onSelect={item.onSelect}
        />
      ))}
    </>
  );
}

/**
 * The hover affordance for a row the package's `SessionRow` does not draw (a company desk
 * row): the direct actions, then the ellipsis that opens the row's context menu anchored at
 * itself. Desktop only, and hidden from taps as well as from sight while it is not revealed —
 * the package's `RowHoverActions` says why.
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
  return (
    <RowHoverActions
      actions={sessionRowActions(actions, state, onRun)}
      moreLabel={S.chat.moreActions}
      onMore={onMore}
    />
  );
}
