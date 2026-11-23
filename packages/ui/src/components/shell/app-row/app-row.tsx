/**
 * An app's row in the sidebar's app list: the app's icon, its name, and the marks the App
 * Center's tile wears for the same states, at a row's size. A click opens the app; the row is
 * selected while the app's window is the one on screen.
 *
 * - Building: the icon dims under a turning ring; the row does not open (`aria-disabled`), the way
 *   the tile does not, unless the app is already running and has a window to bring back.
 * - Failed: the icon dims and a warning mark sits on its corner; the row still opens.
 *
 * Every mark is drawn for the eye only. What it means is in the row's name and its hint, which
 * the caller words (`label`, `hint`): the hint is marked as saying what the screen does not, so
 * it shows over the visible name.
 *
 * Its menu holds the caller's actions, at the pointer on a right-click, from the keyboard with
 * Shift+F10, on touch with a press-and-hold, and from the "more" button the hover reveals
 * (`useRowContextMenu`, the conversation rows' pattern); a hold's replayed click does not also
 * open the app.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { InstallRing } from "../../icons/spinner/spinner";
import { NAV_FILL } from "../../navigation/nav-list/nav-list";
import { Dropdown } from "../../overlays/dropdown/dropdown";
import { Menu, MenuItem } from "../../overlays/menu/menu";
import { useRowContextMenu } from "../../overlays/portal-panel/use-row-context-menu";
import { RowHoverActions, type RowActionItem } from "../session-row/session-row";

/** The icon's edge on a row, in px: a nav row's glyph rung, since the app is the row. */
export const APP_ROW_ICON_PX = ICON_SIZE.navRow;

/** The ring sits just outside the icon, as the tile's does. */
const RING_PX = APP_ROW_ICON_PX + 6;

export interface AppRowProps {
  /** The app's key, written on the row for the app and its tests to find it by. */
  appKey: string;
  /** Page lists can reorder the row or drop its page onto a pane. */
  drag?: Pick<HTMLAttributes<HTMLElement>, "draggable" | "onDragStart" | "onDragOver" | "onDrop">;
  /** The app's icon, drawn by the caller at `APP_ROW_ICON_PX`. */
  icon: ReactNode;
  /** The app's name in the reader's language. */
  name: string;
  /** A visible pane marker, with its accessible wording in label. */
  suffix?: ReactNode;
  /** The row's accessible name, when it says more than the name (its state, its Agent). */
  label?: string;
  /** What the hint says beyond the visible name; none when it would only repeat it. */
  hint?: string;
  /** Its window is the one on screen: the selected fill and `aria-current`. */
  active?: boolean;
  /** Its window is open, shown or minimized. */
  running?: boolean;
  /** Where its build stands, as the tile marks it. */
  build?: "ready" | "building" | "failed";
  /** The row's menu. */
  menuActions: readonly RowActionItem[];
  /** Useful window controls placed directly after More, including on touch devices. */
  windowActions?: readonly RowActionItem[];
  /** The "more" button's name and hint. */
  moreLabel: string;
  onOpen: () => void;
}

export function AppRow({
  appKey,
  drag,
  icon,
  name,
  suffix,
  label,
  hint,
  active = false,
  running = false,
  build = "ready",
  menuActions,
  windowActions,
  moreLabel,
  onOpen,
}: AppRowProps) {
  const ctx = useRowContextMenu();
  const building = build === "building";
  const failed = build === "failed";
  /** A building app opens only when its window is already there to bring back. */
  const closed = building && !running;
  /** A menu row hands focus back to the row before acting, as a conversation row's does. */
  const fromMenu = (action: RowActionItem) => () => {
    ctx.returnFocus()?.focus();
    ctx.close();
    action.onSelect();
  };
  return (
    <li className="relative" onDragOver={drag?.onDragOver} onDrop={drag?.onDrop}>
      <div
        ref={ctx.rowRef}
        {...ctx.rowProps}
        className={`group flex select-none items-center rounded-md pr-1 transition-colors duration-150 ${
          active ? NAV_FILL.selected : NAV_FILL.hover
        }`}
      >
        <button
          type="button"
          draggable={drag?.draggable}
          onDragStart={drag?.onDragStart}
          data-app-row={appKey}
          aria-current={active ? "page" : undefined}
          aria-disabled={closed || undefined}
          {...(label !== undefined ? { "aria-label": label } : {})}
          {...(hint !== undefined ? { "data-tooltip": hint, "data-tooltip-extra": true } : {})}
          onClick={() => {
            if (ctx.consumeLongPressClick()) return;
            if (!closed) onOpen();
          }}
          className={`flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left ${
            closed ? "cursor-default" : ""
          }`}
        >
          <span
            aria-hidden
            className="relative flex shrink-0 items-center justify-center"
            style={{ width: APP_ROW_ICON_PX, height: APP_ROW_ICON_PX }}
          >
            <span className={`flex ${building || failed ? "opacity-50" : ""}`}>{icon}</span>
            {building && (
              <InstallRing
                size={RING_PX}
                className="pointer-events-none absolute -left-[3px] -top-[3px] text-accent"
              />
            )}
            {failed && (
              <span className="absolute -right-1 -top-1 rounded-full bg-canvas text-tone-attention-fg">
                <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.rowMark} />
              </span>
            )}
          </span>
          <span
            className={`min-w-0 flex-1 truncate font-sans text-sm ${
              active ? "font-medium text-fg" : "text-fg/80"
            }`}
          >
            {name}
          </span>
          {suffix && (
            <span aria-hidden className="shrink-0 text-fg-muted">
              {suffix}
            </span>
          )}
        </button>
        <div
          className={
            windowActions
              ? "flex shrink-0 items-center [&_button]:pointer-events-auto [&_button]:size-7 [&_button]:opacity-100 pointer-coarse:[&_button]:size-10"
              : "invisible flex h-6 shrink-0 items-center group-hover:visible group-focus-within:visible [&_button]:pointer-events-auto [&_button]:opacity-100"
          }
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <RowHoverActions
            actions={windowActions ?? []}
            moreFirst
            moreLabel={moreLabel}
            onMore={ctx.openAt}
          />
        </div>
        <Dropdown
          open={ctx.open}
          setOpen={ctx.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={ctx.anchor}
          anchorOwner={ctx.anchorOwner}
          returnFocus={ctx.returnFocus}
          className="contents"
          menuClass="w-48"
          button={null}
        >
          <Menu label={name} density="sm" className="py-1">
            {menuActions.map((action) => (
              <MenuItem
                key={action.id}
                glyph={action.glyph}
                label={action.label}
                danger={action.danger === true}
                onSelect={fromMenu(action)}
              />
            ))}
          </Menu>
        </Dropdown>
      </div>
    </li>
  );
}
