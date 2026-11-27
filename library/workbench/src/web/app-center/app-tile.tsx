/**
 * The App Center's tiles, a phone home screen's: the icon, and the name under it in at most two
 * lines. The whole title and the Agent that owns the app are the tile's hint; nothing else is
 * written on it.
 *
 * - An app tile opens the app. While the app builds, its icon is dimmed under a turning ring and
 *   it does not open (its menu's open rows are disabled too); it turns live by itself when the
 *   build ends. An app whose last load failed is the dimmed tile with a warning mark: it still
 *   opens, and its menu shows the error. A system app's tile is always ready; its hint says it is
 *   a system app instead of naming an Agent.
 * - A system app with something waiting on its page (a plugin update, new presets, unexpected
 *   errors) wears the update dot on its icon's corner, and its hint and accessible name add that
 *   trail's sentence: the App Center's nav entry carries the same dot, and the page clears it
 *   (lib/system-app-notes.ts). A folder holding such an app wears the dot too, with the
 *   sentences of the apps inside, so the trail never ends at a closed folder.
 * - An app that is running behind the grid (its window minimized) keeps its running state in its
 *   accessible name and hint; a click brings its
 *   window back, even while it builds. A folder holding one has the same bar, and says how many.
 *   A system app runs like any app when it opens in a window (a server module's iframe page);
 *   one that opens as its own page never runs.
 * - A folder tile shows the first four of its apps' icons in a 2×2 square and opens the folder.
 * - What a drag would do is marked here: a line in the gap beside the tile, or an outline around
 *   the icon it would go into. Neither moves anything. The tile's `data-drop` names the mark it
 *   wears.
 *
 * A state never changes a tile's box: the ring and the marks are laid over the icon's square,
 * which is the same 56 px in every state. App and folder icons share the app icon shape
 * (`AppIconShape`), whose corner scales with the icon, so a folder's previews are the outline of
 * the icons they grow into when it opens.
 *
 * Icons are images (`ImageIcon`) from the URL the server serves them at under a sandboxing
 * policy, never markup put into the page. An icon that fails to load falls back to the letter
 * tile.
 */
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  APP_ICON_PX,
  AgentAvatar,
  AppIconShape,
  ContextMenu,
  GlyphAppIcon,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  ImageIcon,
  InstallRing,
  LaunchTile,
  UpdateDot,
} from "@prismshadow/penguin-ui";
import { S, toneInk } from "@prismshadow/penguin-web/internal";
import { skillTileColor } from "@prismshadow/penguin-web/features/skills";

import type { GridApp, GridFolder, LocatedShortcut, Side } from "./arrangement";

/** Edge of a tile's icon, in px: the phone home screen's size, large enough to read a glyph in. */
const ICON_PX = APP_ICON_PX;
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
 * a square in the id's colour with the title's first letter. Either is cut to the app icon shape
 * at its size, so a small icon is the same outline as a full one. A system app wears its page's
 * glyph on the same shape (the UI package's `GlyphAppIcon`).
 */
interface TileOwner {
  id: string;
  src: string | undefined;
}

export function TileIcon({
  shortcut,
  owner,
  title,
  size = ICON_PX,
}: {
  /** What draws it: the app's icon, else its letter tile in its id's colour, or a system glyph. */
  shortcut: Pick<LocatedShortcut, "workbenchId" | "icon" | "system">;
  title: string;
  size?: number;
  owner?: TileOwner | undefined;
}) {
  if (shortcut.system !== undefined)
    return <GlyphAppIcon appKey={shortcut.workbenchId} d={shortcut.system.glyph} size={size} />;
  const letter = (
    <span
      aria-hidden
      className={`flex size-full items-center justify-center font-semibold ${
        size >= ICON_PX ? "text-2xl" : "text-xs"
      } ${skillTileColor(shortcut.workbenchId)}`}
    >
      {[...title][0]?.toUpperCase() ?? "?"}
    </span>
  );
  const icon = (
    <AppIconShape aria-hidden size={size}>
      <ImageIcon icon={shortcut.icon ?? null} size={size} fallback={letter} />
    </AppIconShape>
  );
  if (!owner) return icon;
  const badgeSize = size === ICON_PX ? 19 : 9;
  return (
    <span className="relative block" style={{ width: size, height: size }}>
      {icon}
      <span
        aria-hidden
        data-workbench-owner={owner.id}
        className="pointer-events-none absolute top-0 left-0 flex rounded-sm bg-canvas ring-1 ring-canvas"
      >
        <AgentAvatar id={owner.id} src={owner.src} size={badgeSize} />
      </span>
    </span>
  );
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

/** An outline follows the icon's shape and stays visible outside its clipped fill. */
const DROP_OUTLINE = "outline-2 outline-offset-4 outline-accent";

/**
 * The update dot on an icon's top-right corner, straddling it: the page surface's dot (no ring),
 * placed the way a page button wears it.
 */
function TileDot() {
  return <UpdateDot size="inline" position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2" />;
}

/** A tile's hint or name with the sentence of what waits on its page, when something does. */
function withNote(text: string, note: string | null): string {
  return note === null ? text : S.todo.joined([text, note]);
}

export const appTriggerId = (id: string) => `app-center-app-${id}`;

export function AppTile({
  app,
  inFolder,
  owner: tileOwner,
  title,
  drag,
  mark,
  lifted,
  running,
  menuItems,
  onOpen,
  note = null,
}: {
  app: GridApp;
  owner?: TileOwner | undefined;
  /** In an open folder, where its icon travels from the folder's preview of it. */
  inFolder: boolean;
  /** The title in the reader's language. */
  title: string;
  /** What is waiting on the app's page (a system app's trail), for its dot; null for none. */
  note?: string | null;
  drag: TileDragProps;
  mark: TileMark;
  /** This tile is the one being dragged. */
  lifted: boolean;
  /** The app is running, its window minimized: a click brings that window back. */
  running: boolean;
  menuItems: (close: () => void) => ReactNode;
  onOpen: () => void;
}) {
  const { shortcut } = app;
  const owner = [shortcut.agentName, shortcut.machineLabel].filter(Boolean).join(" · ");
  const building = shortcut.build === "building";
  const failed = shortcut.build === "failed";
  /**
   * Whether a click does nothing: an app out of reach never opens, and a building one opens only
   * when it is already running, with a window to bring back.
   */
  const closed = shortcut.unavailable === true || (building && !running);
  const state = running
    ? S.appCenter.running
    : building
      ? S.appCenter.building
      : failed
        ? S.appCenter.broken
        : null;
  // A system app is always ready, and the platform's rather than an Agent's: it says so instead.
  const system = shortcut.system !== undefined;
  const tip = withNote(
    system
      ? running
        ? S.appCenter.systemRunningTip(title)
        : S.appCenter.systemTileName(title, null)
      : running
        ? S.appCenter.runningTip(title, owner)
        : building
          ? S.appCenter.buildingTip(title, owner)
          : failed
            ? S.appCenter.failedTip(title, owner)
            : S.appCenter.tileTip(title, owner),
    note,
  );
  const name = withNote(
    system ? S.appCenter.systemTileName(title, state) : S.appCenter.tileName(title, owner, state),
    note,
  );
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
          <LaunchTile
            ref={target.ref}
            {...target.props}
            id={appTriggerId(app.id)}
            aria-label={name}
            aria-disabled={closed || undefined}
            data-tooltip={tip}
            data-tooltip-extra
            onClick={() => {
              // A press-and-hold that opened the menu must not also open the app.
              if (target.consumeLongPressClick()) return;
              if (!closed) onOpen();
            }}
            className={`${closed ? "cursor-default" : ""} ${
              failed || shortcut.unavailable ? "opacity-60" : ""
            } ${lifted ? "opacity-40" : ""}`}
            icon={
              <AppIconShape
                clip={false}
                data-unfold-art={inFolder ? app.id : undefined}
                className={`relative ${mark === "into" ? DROP_OUTLINE : ""}`}
              >
                <span className={`block ${building ? "opacity-50" : ""}`}>
                  <TileIcon shortcut={shortcut} title={title} owner={tileOwner} />
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
                {note !== null && <TileDot />}
              </AppIconShape>
            }
            name={title}
            unfoldFade={inFolder}
          >
            {shortcut.machineLabel && (
              <span
                data-unfold-fade={inFolder || undefined}
                className="max-w-full truncate text-xs text-fg-muted"
              >
                {shortcut.machineLabel}
              </span>
            )}
          </LaunchTile>
        )}
      </ContextMenu>
    </li>
  );
}

export const folderTriggerId = (id: string) => `app-center-trigger-${id}`;
export const folderPanelId = (id: string) => `app-center-folder-${id}`;

export function FolderTile({
  folder,
  expanded,
  titleOf,
  ownerOf,
  drag,
  mark,
  lifted,
  running,
  menuItems,
  onOpen,
  notes = [],
}: {
  folder: GridFolder;
  ownerOf?: (app: GridApp) => TileOwner | undefined;
  expanded: boolean;
  /** An app's title in the reader's language. */
  titleOf: (shortcut: AppCenterShortcut) => string;
  /** What is waiting on the pages of the apps inside, in their order, for the folder's dot. */
  notes?: readonly string[];
  drag: TileDragProps;
  mark: TileMark;
  lifted: boolean;
  /** How many of its apps are running, their windows minimized. */
  running: number;
  menuItems: (close: () => void) => ReactNode;
  onOpen: () => void;
}) {
  const count = folder.apps.length;
  return (
    <li className="relative" data-folder={folder.id} data-drop={mark ?? undefined} {...drag}>
      {(mark === "before" || mark === "after") && <DropLine side={mark} />}
      <ContextMenu label={folder.name} items={menuItems} width={MENU_PX}>
        {(target) => (
          <LaunchTile
            ref={target.ref}
            {...target.props}
            id={folderTriggerId(folder.id)}
            aria-expanded={expanded}
            aria-controls={expanded ? folderPanelId(folder.id) : undefined}
            aria-label={S.todo.joined([
              S.appCenter.folderName(folder.name, count, running),
              ...notes,
            ])}
            data-tooltip={S.todo.joined([
              S.appCenter.folderTip(folder.name, count, running),
              ...notes,
            ])}
            data-tooltip-extra
            onClick={() => {
              if (target.consumeLongPressClick()) return;
              onOpen();
            }}
            className={lifted ? "opacity-40" : ""}
            icon={
              // The update dot sits outside the folder's square, which clips its previews.
              <span className="relative block">
                {/* The open folder unfolds from this square, its apps from their previews in it. */}
                <AppIconShape
                  data-unfold-from
                  className={`relative grid grid-cols-2 content-start bg-fg/10 ${mark === "into" ? DROP_OUTLINE : ""}`}
                  style={{ padding: FOLDER_INSET_PX, gap: FOLDER_GAP_PX }}
                >
                  {folder.apps.slice(0, 4).map((app) => (
                    <span key={app.id} data-unfold-source={app.id} className="flex">
                      <TileIcon
                        shortcut={app.shortcut}
                        title={titleOf(app.shortcut)}
                        size={MINI_PX}
                        owner={ownerOf?.(app)}
                      />
                    </span>
                  ))}
                </AppIconShape>
                {notes.length > 0 && <TileDot />}
              </span>
            }
            name={folder.name}
          />
        )}
      </ContextMenu>
    </li>
  );
}
