/**
 * The App Center's tiles, a phone home screen's: the icon, and the name under it in at most two
 * lines. The whole title and the Agent that owns the app are the tile's hint; nothing else is
 * written on it.
 *
 * - An app tile opens the app. While the app builds, its icon is dimmed under a turning ring and
 *   it does not open (its menu's open rows are disabled too); it turns live by itself when the
 *   build ends. An app whose last load failed is the dimmed tile with a warning mark: it still
 *   opens, and its menu shows the error.
 * - A folder tile shows the first four of its apps' icons in a 2×2 square and opens the folder.
 * - What a drag would do is marked here: a line in the gap beside the tile, or a ring around the
 *   icon it would go into. Neither moves anything. The tile's `data-drop` names the mark it wears.
 *
 * A state never changes a tile's box: the ring and the marks are laid over the icon's square,
 * which is the same 56 px in every state.
 *
 * Icons are images (`ImageIcon`) from the URL the server serves them at under a sandboxing
 * policy, never markup put into the page. An icon that fails to load falls back to the letter
 * tile.
 */
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  ContextMenu,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  ImageIcon,
  InstallRing,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { skillTileColor } from "../skills";
import type { GridApp, GridFolder, Side } from "./arrangement";

/** Edge of a tile's icon, in px: the phone home screen's size, large enough to read a glyph in. */
export const ICON_PX = 56;
/** The install ring sits just outside the icon's square. */
const RING_PX = ICON_PX + 12;
/** A folder's square holds up to four icons, two by two, with this inset and gap (px). */
const FOLDER_INSET_PX = 6;
const FOLDER_GAP_PX = 4;
const MINI_PX = (ICON_PX - 2 * FOLDER_INSET_PX - FOLDER_GAP_PX) / 2;

/**
 * The width of the App Center's menus, in px: their longest row ("Remove from the App Center")
 * whole at the largest text size.
 */
export const MENU_PX = 256;

/** What a drop over this tile would do, for its mark. */
export type TileMark = Side | "into" | null;

export interface TileDragProps {
  draggable: true;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
  onDrop: (e: ReactDragEvent<HTMLElement>) => void;
}

/**
 * The app's own icon — an image from the URL the server serves it at (`ImageIcon`: an `<img>`, or
 * a mask in the text colour for a monochrome SVG) — else, and whenever that image fails to load,
 * a square in the id's colour with the title's first letter.
 */
export function TileIcon({
  shortcut,
  title,
  size = ICON_PX,
}: {
  shortcut: AppCenterShortcut;
  title: string;
  size?: number;
}) {
  const round = size >= ICON_PX ? "rounded-xl" : "rounded-md";
  const letter = (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center font-semibold ${round} ${
        size >= ICON_PX ? "text-2xl" : "text-xs"
      } ${skillTileColor(shortcut.workbenchId)}`}
    >
      {[...title][0]?.toUpperCase() ?? "?"}
    </span>
  );
  return <ImageIcon icon={shortcut.icon ?? null} size={size} fallback={letter} className={round} />;
}

/** The line in the gap beside a tile, where the dragged one would land. */
function DropLine({ side }: { side: Side }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-y-2 z-raised w-0.5 rounded-full bg-accent ${
        side === "before" ? "-left-2" : "-right-2"
      }`}
    />
  );
}

/** The ring around an icon square that the dragged app would go into. */
function IntoRing() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-1 rounded-2xl ring-2 ring-accent"
    />
  );
}

/**
 * A tile is pressed and held for its menu on touch, so neither the text selection nor the
 * picture's own callout (save image, share) may answer the hold instead.
 */
const TILE_BUTTON =
  "flex w-full select-none flex-col items-center gap-2 rounded-lg p-2 text-center transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-fg/5 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";

/** The name under the icon: two lines at most, then an ellipsis. */
function TileName({ children }: { children: ReactNode }) {
  return (
    <span className="line-clamp-2 w-full break-words text-sm leading-snug text-fg">{children}</span>
  );
}

export function AppTile({
  app,
  title,
  drag,
  mark,
  lifted,
  menuItems,
  onOpen,
}: {
  app: GridApp;
  /** The title in the reader's language. */
  title: string;
  drag: TileDragProps;
  mark: TileMark;
  /** This tile is the one being dragged. */
  lifted: boolean;
  menuItems: (close: () => void) => ReactNode;
  onOpen: () => void;
}) {
  const { shortcut } = app;
  const building = shortcut.build === "building";
  const failed = shortcut.build === "failed";
  const state = building ? S.appCenter.building : failed ? S.appCenter.broken : null;
  const tip = building
    ? S.appCenter.buildingTip(title, shortcut.agentName)
    : failed
      ? S.appCenter.failedTip(title, shortcut.agentName)
      : S.appCenter.tileTip(title, shortcut.agentName);
  return (
    <li
      className="relative"
      data-app={app.id}
      data-build={shortcut.build}
      data-drop={mark ?? undefined}
      {...drag}
    >
      {(mark === "before" || mark === "after") && <DropLine side={mark} />}
      <ContextMenu label={title} items={menuItems} width={MENU_PX}>
        {(target) => (
          <button
            ref={target.ref}
            {...target.props}
            type="button"
            aria-label={S.appCenter.tileName(title, shortcut.agentName, state)}
            aria-disabled={building || undefined}
            data-tooltip={tip}
            data-tooltip-extra
            onClick={() => {
              // A press-and-hold that opened the menu must not also open the app.
              if (target.consumeLongPressClick()) return;
              if (!building) onOpen();
            }}
            className={`${TILE_BUTTON} ${building ? "cursor-default" : ""} ${
              failed ? "opacity-60" : ""
            } ${lifted ? "opacity-40" : ""}`}
          >
            <span className="relative block" style={{ width: ICON_PX, height: ICON_PX }}>
              <span className={`block ${building ? "opacity-50" : ""}`}>
                <TileIcon shortcut={shortcut} title={title} />
              </span>
              {building && (
                <InstallRing
                  size={RING_PX}
                  className="pointer-events-none absolute -top-1.5 -left-1.5 text-accent"
                />
              )}
              {failed && (
                <span
                  aria-hidden
                  className={`absolute -top-1.5 -left-1.5 rounded-full bg-canvas ${toneInk.attention}`}
                >
                  <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.rowLead} />
                </span>
              )}
              {mark === "into" && <IntoRing />}
            </span>
            <TileName>{title}</TileName>
          </button>
        )}
      </ContextMenu>
    </li>
  );
}

export function FolderTile({
  folder,
  titleOf,
  drag,
  mark,
  lifted,
  menuItems,
  onOpen,
}: {
  folder: GridFolder;
  /** An app's title in the reader's language. */
  titleOf: (shortcut: AppCenterShortcut) => string;
  drag: TileDragProps;
  mark: TileMark;
  lifted: boolean;
  menuItems: (close: () => void) => ReactNode;
  onOpen: () => void;
}) {
  const count = folder.apps.length;
  return (
    <li className="relative" data-folder={folder.id} data-drop={mark ?? undefined} {...drag}>
      {(mark === "before" || mark === "after") && <DropLine side={mark} />}
      <ContextMenu label={folder.name} items={menuItems} width={MENU_PX}>
        {(target) => (
          <button
            ref={target.ref}
            {...target.props}
            type="button"
            aria-haspopup="dialog"
            aria-label={S.appCenter.folderName(folder.name, count)}
            data-tooltip={S.appCenter.folderTip(folder.name, count)}
            data-tooltip-extra
            onClick={() => {
              if (target.consumeLongPressClick()) return;
              onOpen();
            }}
            className={`${TILE_BUTTON} ${lifted ? "opacity-40" : ""}`}
          >
            <span
              className="relative grid grid-cols-2 content-start rounded-xl bg-fg/10"
              style={{
                width: ICON_PX,
                height: ICON_PX,
                padding: FOLDER_INSET_PX,
                gap: FOLDER_GAP_PX,
              }}
            >
              {folder.apps.slice(0, 4).map((app) => (
                <TileIcon
                  key={app.id}
                  shortcut={app.shortcut}
                  title={titleOf(app.shortcut)}
                  size={MINI_PX}
                />
              ))}
              {mark === "into" && <IntoRing />}
            </span>
            <TileName>{folder.name}</TileName>
          </button>
        )}
      </ContextMenu>
    </li>
  );
}
