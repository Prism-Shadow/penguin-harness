/**
 * What the App Center's context menus hold: an app tile's, a folder tile's, and the grid's own
 * for its empty space. Every arrangement the pointer makes by dragging is here too, so the
 * keyboard (Shift+F10, the ContextMenu key) and touch (press and hold) reach all of it: "Move
 * to…" opens the new-folder dialog with the app picked, puts it into a folder or makes a new
 * folder with another app, and forward / backward step an item through the grid or its folder.
 * The empty space's menu opens the new-folder dialog too.
 *
 * "Move to…" opens a second page in the same menu rather than a submenu, which a phone has no
 * room for: Back returns to the first page, and focus moves to the first row of whichever page
 * is shown.
 */
import { useEffect, useRef, useState } from "react";
import {
  FOCUSABLE_SELECTOR,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from "@prismshadow/penguin-ui";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import {
  canStep,
  folderOf,
  makeFolder,
  moveIntoFolder,
  newFolderId,
  stepItem,
  takeOutOfFolder,
  type GridApp,
  type GridFolder,
  type GridItem,
} from "./arrangement";
import { TileIcon } from "./app-tile";

/** What the menus act through: the grid as shown, and the page's own actions. */
export interface GridActions {
  grid: readonly GridItem[];
  /** The viewer has an arrangement of their own, so restoring the default does something. */
  customized: boolean;
  titleOf: (shortcut: AppCenterShortcut) => string;
  /** Shows a new arrangement and stores it. */
  arrange: (next: GridItem[]) => void;
  open: (app: GridApp) => void;
  openFullScreen: (app: GridApp) => void;
  showError: (app: GridApp) => void;
  viewInSettings: (app: GridApp) => void;
  removeFromAppCenter: (app: GridApp) => void;
  openFolder: (folder: GridFolder) => void;
  /** Opens the new-folder dialog, with this app picked (null: none). */
  newFolder: (picked: GridApp | null) => void;
  renameFolder: (folder: GridFolder) => void;
  dissolveFolder: (folder: GridFolder) => void;
  restoreDefault: () => void;
}

/** A row that runs an action: the menu closes first, handing focus back to the tile. */
function act(close: () => void, run: () => void): () => void {
  return () => {
    close();
    run();
  };
}

function StepRows({ id, actions, close }: { id: string; actions: GridActions; close: () => void }) {
  const { grid } = actions;
  return (
    <>
      <MenuItem
        glyph={ICONS.arrowLeftCentered}
        label={S.appCenter.menu.moveForward}
        disabled={!canStep(grid, id, -1)}
        onSelect={act(close, () => actions.arrange(stepItem(grid, id, -1)))}
      />
      <MenuItem
        glyph={ICONS.arrowRightCentered}
        label={S.appCenter.menu.moveBackward}
        disabled={!canStep(grid, id, 1)}
        onSelect={act(close, () => actions.arrange(stepItem(grid, id, 1)))}
      />
    </>
  );
}

function RestoreRow({ actions, close }: { actions: GridActions; close: () => void }) {
  return (
    <MenuItem
      glyph={ICONS.rotateCcw}
      label={S.appCenter.menu.restoreDefault}
      disabled={!actions.customized}
      onSelect={act(close, actions.restoreDefault)}
    />
  );
}

/** Moves focus to the first row of the page just shown (the row that switched it is gone). */
function useFocusFirstRow(page: string) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    box.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, [page]);
  return box;
}

export function AppMenu({
  app,
  actions,
  close,
}: {
  app: GridApp;
  actions: GridActions;
  close: () => void;
}) {
  const [page, setPage] = useState<"main" | "move">("main");
  const box = useFocusFirstRow(page);
  const { grid } = actions;
  const building = app.shortcut.build === "building";
  const holder = folderOf(grid, app.id);

  if (page === "move") {
    const folders = grid.filter(
      (item): item is GridFolder => item.type === "folder" && item.id !== holder?.id,
    );
    const partners = grid.filter(
      (item): item is GridApp => item.type === "app" && item.id !== app.id,
    );
    return (
      <div ref={box} className="contents">
        <MenuItem
          glyph={ICONS.arrowLeft}
          label={S.appCenter.menu.back}
          onSelect={() => setPage("main")}
        />
        <MenuSeparator />
        <MenuItem
          glyph={ICONS.folderPlus}
          label={S.appCenter.menu.newFolder}
          onSelect={act(close, () => actions.newFolder(app))}
        />
        {folders.length > 0 && <MenuLabel>{S.appCenter.menu.toFolders}</MenuLabel>}
        {folders.map((folder) => (
          <MenuItem
            key={folder.id}
            glyph={ICONS.folder}
            label={folder.name}
            onSelect={act(close, () => actions.arrange(moveIntoFolder(grid, app.id, folder.id)))}
          />
        ))}
        {partners.length > 0 && <MenuLabel>{S.appCenter.menu.newFolderWith}</MenuLabel>}
        {partners.map((partner) => {
          const title = actions.titleOf(partner.shortcut);
          return (
            <MenuItem
              key={partner.id}
              glyph={<TileIcon shortcut={partner.shortcut} title={title} size={ICON_SIZE.navRow} />}
              label={title}
              onSelect={act(close, () =>
                actions.arrange(
                  makeFolder(grid, app.id, partner.id, {
                    id: newFolderId(grid),
                    name: S.appCenter.newFolder,
                  }),
                ),
              )}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div ref={box} className="contents">
      <MenuItem
        glyph={ICONS.appWindow}
        label={S.appCenter.menu.open}
        disabled={building}
        onSelect={act(close, () => actions.open(app))}
      />
      <MenuItem
        glyph={ICONS.cornersOut}
        label={S.appCenter.menu.openFullScreen}
        disabled={building}
        onSelect={act(close, () => actions.openFullScreen(app))}
      />
      <MenuSeparator />
      <MenuItem
        glyph={ICONS.folder}
        label={S.appCenter.menu.moveTo}
        trailing={<GlyphIcon d={ICONS.chevronRight} size={ICON_SIZE.chevronDense} />}
        onSelect={() => setPage("move")}
      />
      <StepRows id={app.id} actions={actions} close={close} />
      {holder !== null && (
        <MenuItem
          glyph={ICONS.boxArrowOut}
          label={S.appCenter.menu.removeFromFolder}
          onSelect={act(close, () => actions.arrange(takeOutOfFolder(grid, app.id)))}
        />
      )}
      <MenuSeparator />
      {app.shortcut.build === "failed" && (
        <MenuItem
          glyph={ICONS.alertCircle}
          label={S.appCenter.menu.showError}
          onSelect={act(close, () => actions.showError(app))}
        />
      )}
      <MenuItem
        glyph={ICONS.gear}
        label={S.appCenter.menu.viewInSettings}
        onSelect={act(close, () => actions.viewInSettings(app))}
      />
      <MenuItem
        glyph={ICONS.eyeOff}
        label={S.appCenter.menu.removeFromAppCenter}
        onSelect={act(close, () => actions.removeFromAppCenter(app))}
      />
      {actions.customized && (
        <>
          <MenuSeparator />
          <RestoreRow actions={actions} close={close} />
        </>
      )}
    </div>
  );
}

export function FolderMenu({
  folder,
  actions,
  close,
}: {
  folder: GridFolder;
  actions: GridActions;
  close: () => void;
}) {
  return (
    <>
      <MenuItem
        glyph={ICONS.folderOpen}
        label={S.appCenter.menu.open}
        onSelect={act(close, () => actions.openFolder(folder))}
      />
      <MenuItem
        glyph={ICONS.pencil}
        label={S.appCenter.menu.rename}
        onSelect={act(close, () => actions.renameFolder(folder))}
      />
      <MenuSeparator />
      <StepRows id={folder.id} actions={actions} close={close} />
      <MenuItem
        glyph={ICONS.tiles}
        label={S.appCenter.menu.dissolve}
        onSelect={act(close, () => actions.dissolveFolder(folder))}
      />
      {actions.customized && (
        <>
          <MenuSeparator />
          <RestoreRow actions={actions} close={close} />
        </>
      )}
    </>
  );
}

/** The grid's empty space: a new folder, and restoring the default order. */
export function GridMenu({ actions, close }: { actions: GridActions; close: () => void }) {
  return (
    <>
      <MenuItem
        glyph={ICONS.folderPlus}
        label={S.appCenter.menu.newFolder}
        onSelect={act(close, () => actions.newFolder(null))}
      />
      <RestoreRow actions={actions} close={close} />
    </>
  );
}
