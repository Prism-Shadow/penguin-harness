/**
 * The context menu of one target: what a right-click on it, the keyboard's menu chord while it is
 * focused (Shift+F10, or the ContextMenu key), or a press-and-hold on touch opens.
 *
 * It is the row context menu's parts put together, so it behaves like every other menu in the
 * app: `useRowContextMenu` turns the three gestures into one anchor (the pointer for a click or a
 * hold, the target's own box for the keyboard), and the panel is a portaled `Dropdown` in
 * `anchorRect` mode holding a `Menu` — the shared Escape stack (one Esc closes the menu and hands
 * focus back to the target), the Up/Down walk, the clamp to the viewport, the dismiss on an
 * outside press or a scroll that moves the target, and the `popover` layer above a dialog.
 *
 * The target is the caller's element: `children` receives the ref and the handlers to spread on
 * it. The browser's own menu is suppressed for events raised inside that element only — nothing
 * is bound to the document, so a right-click anywhere else (an app's iframe included, whose
 * events never reach this document) keeps the browser's menu.
 *
 * Targets may nest — a tile inside a grid that has a menu of its own for its empty space — and
 * the innermost one under the gesture owns it: each target is stamped `data-context-menu`, and
 * a gesture is handled by the target that is the nearest stamped ancestor of where it landed.
 *
 * The panel is portaled whole (not only its body), so the target's container keeps exactly the
 * children it renders — a grid's `<ul>` keeps only `<li>`s. Its width is in px: the root font
 * size is the user's choice, and a rem width would grow the menu past the viewport clamp.
 */
import { useCallback } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Dropdown } from "../dropdown/dropdown";
import { FOCUSABLE_SELECTOR } from "../esc-layers/esc-layers";
import { Menu, type MenuDensity } from "../menu/menu";
import type { AnchorRect } from "../portal-panel/context-menu";
import { useRowContextMenu, type ContextMenuRowProps } from "../portal-panel/use-row-context-menu";

/** The marker a target carries, which tells nested targets which one a gesture landed in. */
const TARGET_ATTRIBUTE = "data-context-menu";

/** What the target element takes: the ref, and the handlers and marker to spread on it. */
export interface ContextMenuTarget {
  ref: (el: HTMLElement | null) => void;
  props: Partial<ContextMenuRowProps> & { [TARGET_ATTRIBUTE]?: "" };
  /**
   * True exactly once, for the click a touch screen replays after a press-and-hold opened the
   * menu: the target's own click handler asks first, so the hold does not also activate it.
   */
  consumeLongPressClick: () => boolean;
  /** Whether the menu is open, for the target's pressed look or its `aria-expanded`. */
  open: boolean;
  /** Opens the menu against a box in viewport coordinates (a "more" button's own rect). */
  openAt: (rect: AnchorRect) => void;
}

export interface ContextMenuProps {
  /** The menu's accessible name: what it is the menu of ("Calendar", "App Center"). */
  label: string;
  /** Renders the target, spreading `target.props` and attaching `target.ref`. */
  children: (target: ContextMenuTarget) => ReactNode;
  /**
   * The rows (`MenuItem`, `MenuSeparator`, `MenuLabel`), rendered only while open. A row that acts
   * calls `close` first: it hands focus back to the target and closes the panel, so a keyboard
   * reader keeps their place, and a dialog the action opens takes focus from there.
   */
  items: (close: () => void) => ReactNode;
  /** The panel's width in px. */
  width?: number;
  /** Row density; a context menu takes the small rung. */
  density?: MenuDensity;
  /** No menu: the target gets no handlers, and a right-click shows the browser's own menu. */
  disabled?: boolean;
}

/** The default width: a label of a few words with a leading glyph. */
const DEFAULT_WIDTH_PX = 208;

/** Whether the element the event landed in belongs to this target rather than to a nested one. */
function owns(e: { target: unknown; currentTarget: unknown }): boolean {
  const from = e.target instanceof Element ? e.target : null;
  return from?.closest(`[${TARGET_ATTRIBUTE}]`) === e.currentTarget;
}

export function ContextMenu({
  label,
  children,
  items,
  width = DEFAULT_WIDTH_PX,
  density = "sm",
  disabled = false,
}: ContextMenuProps) {
  const ctx = useRowContextMenu();
  const { anchorOwner, close: closeMenu, rowProps, openAt } = ctx;

  /** The target itself when it takes focus (a tile's button), else the first control inside it. */
  const returnFocus = useCallback((): HTMLElement | null => {
    const el = anchorOwner();
    if (el === null) return null;
    return el.matches(FOCUSABLE_SELECTOR) ? el : el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  }, [anchorOwner]);

  const close = useCallback(() => {
    returnFocus()?.focus();
    closeMenu();
  }, [returnFocus, closeMenu]);

  const props: ContextMenuTarget["props"] = disabled
    ? {}
    : {
        [TARGET_ATTRIBUTE]: "",
        onContextMenu: (e) => {
          if (owns(e)) rowProps.onContextMenu(e);
        },
        onKeyDown: (e) => {
          if (owns(e)) rowProps.onKeyDown(e);
        },
        onPointerDown: (e) => {
          if (owns(e)) rowProps.onPointerDown(e);
        },
        onPointerMove: rowProps.onPointerMove,
        onPointerUp: rowProps.onPointerUp,
        onPointerCancel: rowProps.onPointerCancel,
      };

  return (
    <>
      {children({
        ref: ctx.rowRef,
        props,
        consumeLongPressClick: ctx.consumeLongPressClick,
        open: ctx.open && !disabled,
        openAt,
      })}
      {ctx.open &&
        !disabled &&
        typeof document !== "undefined" &&
        createPortal(
          <Dropdown
            open
            setOpen={ctx.setOpen}
            portal={{ direction: "down", align: "left" }}
            anchorRect={ctx.anchor}
            anchorOwner={anchorOwner}
            returnFocus={returnFocus}
            className="contents"
            menuClass="origin-top-left"
            menuStyle={{ width }}
            button={null}
          >
            <Menu label={label} density={density}>
              {items(close)}
            </Menu>
          </Dropdown>,
          document.body,
        )}
    </>
  );
}
