/**
 * Actions on a sidebar Session row, and the two surfaces that offer them.
 *
 * The row carries a **pared-back hover affordance** and a **full context menu**, and this
 * module owns which actions belong to each so the two cannot drift:
 *
 * - Hovering a row reveals archive and delete as direct icon buttons — the shape the row
 *   had in every released version up to v0.2.2, restored here after the 0.3 line had
 *   folded them into an ellipsis dropdown.
 * - Right-clicking a row (or holding it on touch, or Shift+F10 on the keyboard) opens the
 *   whole set — pin, rename, archive, delete — as a labelled menu.
 *
 * Rename therefore keeps a home: `design/specs/06-PROTOTYPE.md` requires that every
 * Session支持重命名、归档与删除, and paring the hover affordance down would otherwise have
 * dropped rename off the row entirely.
 */
import { S } from "../../lib/strings";
import { Icon } from "./group-list";

/** Pushpin (lucide pin: head + body + stem), the group-header pin toggle / pinned indicator. */
export const PIN_ICON =
  "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z";

/** Row-action glyphs (thin-line, matching the shared Icon set): pencil / archive / unarchive / trash. */
export const PENCIL_ICON = "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3";
export const ARCHIVE_ICON =
  "M3 8h18M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M4 8l1.5-3h13L20 8M9.5 13.5 12 16l2.5-2.5";
export const UNARCHIVE_ICON =
  "M3 8h18M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M4 8l1.5-3h13L20 8M12 17v-5m-2.5 2L12 11l2.5 3";
export const TRASH_ICON =
  "M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 10.5v6M14 10.5v6";
/** Paper plane (lucide send): the Feishu-binding action and the bound row's indicator. */
export const FEISHU_ICON = "M22 2 11 13M22 2l-7 20-4-9-9-4z";

/** Compact overflow-menu row (session row menu + workspace group menu): small text, leading thin-line glyph. */
export const overflowMenuRowClass =
  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

/** The overflow menus' destructive row (delete keeps the red treatment; its glyph inherits the red). */
export const overflowMenuDangerClass =
  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-red-600 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40";

/** The overflow menus' muted leading glyph (a danger row inlines its own so the red inherits). */
export const overflowMenuGlyph = (d: string) => (
  <span className="shrink-0 text-gray-400 dark:text-gray-500">
    <Icon d={d} size={13} />
  </span>
);

/** One thing a Session row can do to its Session. */
export type SessionRowAction = "pin" | "rename" | "feishu" | "archive" | "delete";

/** Row state the labels and glyphs read (both of the toggles flip on it). */
export interface SessionRowState {
  archived: boolean;
  pinned: boolean;
}

/**
 * The hover affordance's actions, restored to the released shape: archive and delete,
 * nothing else. Everything else on the row is one right-click away.
 */
export const HOVER_ROW_ACTIONS: readonly SessionRowAction[] = ["archive", "delete"];

/**
 * The context menu's actions. Pin only reorders rows in the active list, so folder rows
 * (archived / subagent / scheduled) offer the rest without it — the same gate the
 * ellipsis menu applied before this moved. Feishu binding sits with the other
 * configuration actions, before the archive/delete pair.
 */
export function contextMenuActions(canPin: boolean): readonly SessionRowAction[] {
  return canPin
    ? ["pin", "rename", "feishu", "archive", "delete"]
    : ["rename", "feishu", "archive", "delete"];
}

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
        icon: PIN_ICON,
        danger: false,
      };
    case "rename":
      return { label: S.chat.renameSession, icon: PENCIL_ICON, danger: false };
    case "feishu":
      return { label: S.feishu.bindAction, icon: FEISHU_ICON, danger: false };
    case "archive":
      return {
        label: state.archived ? S.chat.unarchiveSession : S.chat.archiveSession,
        icon: state.archived ? UNARCHIVE_ICON : ARCHIVE_ICON,
        danger: false,
      };
    case "delete":
      return { label: S.chat.deleteSession, icon: TRASH_ICON, danger: true };
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
            {item.danger ? (
              /* The glyph inherits the row's red. */
              <span className="shrink-0">
                <Icon d={item.icon} size={13} />
              </span>
            ) : (
              overflowMenuGlyph(item.icon)
            )}
            {item.label}
          </button>
        );
      })}
    </>
  );
}

/**
 * Hover affordance: icon-only buttons that fade in over the row, the pre-0.3 treatment.
 * Deliberately hover/focus-gated and therefore desktop-only — Tailwind scopes `hover:`
 * behind `@media (hover: hover)`, so these never appear on a touch screen, where the same
 * actions are reached by holding the row instead.
 *
 * Which is why they are **pointer-events-gated on exactly the same conditions as their
 * opacity**, not just faded out: an invisible button still takes taps, so a bare
 * `opacity-0` would leave a phantom delete target sitting over the right end of every row
 * for the one class of user who can never see it. Keyboard focus is unaffected by
 * `pointer-events`, so Tab still reaches them and revealing them re-arms the click.
 */
export function SessionRowHoverActions({
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
            title={item.label}
            aria-label={item.label}
            onClick={() => onRun(action)}
            className={`pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-all duration-150 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 ${
              item.danger
                ? "hover:text-red-600 dark:hover:text-red-400"
                : "hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
            }`}
          >
            <Icon d={item.icon} size={14} />
          </button>
        );
      })}
    </>
  );
}
