/**
 * The App Center (/apps): the Project's home screen. One tile per workbench of the Project's
 * Agents whose manifest asks to be shown (`penguin.appCenter.show`), each the app's icon and name;
 * the server reads them from the files without loading anything, so opening this page starts no
 * build. An administrator sees the apps of the Project's machines too, after this server's, each
 * with its machine's name under its own (use-app-center.ts); a machine out of reach keeps the
 * tiles it last showed, which do not open, and a note under the grid names it.
 *
 * - The arrangement is the viewer's own: they drag tiles to reorder them and onto one another to
 *   make folders, or make one from the "New folder" dialog (the header's button, the grid's
 *   menu, a tile's "Move to…"), and it is kept with their account, per Project (arrangement.ts).
 *   A new app is appended, one that went away drops out, and a folder goes only once it is
 *   empty. Restoring the default order asks first.
 * - A click (or Enter) opens the app windowed, over the grid, in this page's own window stack
 *   (`?app=<agentId>/<workbenchId>`, `<machineId>:` first for a machine's, so Back closes it);
 *   the tile's menu also opens it full screen, the full page whose exit comes back here.
 * - A folder unfolds in place from its icon (`?folder=<id>`, so Back closes it too;
 *   folder-panel.tsx). Closing a window, a folder or the full page goes back to the host's own
 *   entry for the view beneath, however many pages the app's frame went through
 *   (lib/host-history.ts), and the focus goes back to the tile.
 * - A tile whose app is building shows a turning ring and does not open; it turns live by itself
 *   when the build ends (use-app-center.ts follows the server's workbench news).
 * - Every tile, every folder and the grid's empty space have a context menu: right-click,
 *   Shift+F10 or the ContextMenu key, or press and hold on touch. It is also the keyboard's and
 *   touch's way to arrange the grid.
 *
 * With nothing to show, the page says what a workbench is and offers to have one built; there is
 * no manual path, so the AI button stands alone.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  AppIconShape,
  AppWindow,
  Button,
  ConfirmModal,
  ContextMenu,
  EmptyState,
  GlyphIcon,
  ICONS,
  Notice,
  NoticeStrip,
  PageHeader,
  Skeleton,
  WindowStack,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { agentSettingsPath } from "../../lib/agent-location";
import { APP_CENTER_PATH } from "../../lib/app-center-path";
import { openFullPage, returnToHostEntry } from "../../lib/host-history";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { AiCreateButtons, AiCreateModal } from "../ai-create";
import type { AiExample } from "../ai-create";
import { AppCenterWindow } from "./app-center-window";
import { appTriggerId, AppTile, FolderTile, MENU_PX, type TileMark } from "./app-tile";
import {
  arrange,
  dissolveFolder,
  findItem,
  groupApps,
  layoutOf,
  keepUnseenApps,
  makeFolder,
  moveBeside,
  moveIntoFolder,
  moveToEnd,
  newFolderId,
  renameFolder,
  sameArrangement,
  takeOutOfFolder,
  type GridApp,
  type GridFolder,
  type GridItem,
} from "./arrangement";
import { BuildErrorDialog } from "./build-error-dialog";
import { FolderNameDialog } from "./folder-name-dialog";
import { FolderPanel } from "./folder-panel";
import { NewFolderDialog } from "./new-folder-dialog";
import { AppMenu, FolderMenu, GridMenu, type GridActions } from "./tile-menus";
import { useTileDrag, type Drop, type Dragged } from "./tile-drag";
import { useAppCenter } from "./use-app-center";

/** The Skills a "Create with AI" conversation opens with: the visual language, then the workbench's own. */
const APP_SKILLS = ["web-design", "penguin-plugin"];

/** The query that names the app open in a window. */
const OPEN_PARAM = "app";
/** The query that names the open folder. */
const FOLDER_PARAM = "folder";
/** The history state a window's entry is pushed with: leaving it is a step back. */
const WINDOW_ENTRY_STATE = { appCenterWindow: true };

/** Three tiles a row on a phone, as a home screen has; as many as fit from `sm` up. */
const GRID = "grid grid-cols-3 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]";

function aiExamples(): AiExample[] {
  return Object.entries(S.appCenter.aiCreateExamples).map(([key, ex]) => ({
    key,
    label: ex.label,
    description: ex.description,
    prompt: ex.prompt,
  }));
}

/** The mark a tile wears for the drop the pointer would make now. */
function markOf(drop: Drop | null, id: string): TileMark {
  if (drop === null) return null;
  if (drop.kind === "beside" && drop.targetId === id) return drop.side;
  if (drop.kind === "into" && drop.targetId === id) return "into";
  return null;
}

/** The App Center's route with `params`: the grid, an open folder, a window. */
function appCenterPath(params: URLSearchParams): string {
  return params.size ? APP_CENTER_PATH + "?" + params : APP_CENTER_PATH;
}

export function AppCenterPage() {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  /** The Agent list as a value: a new array with the same Agents does not read again. */
  const agentIds = agents.map((agent) => agent.agentId).join("\n");
  const {
    shortcuts,
    layout,
    error,
    reload,
    saveLayout,
    refreshMachine,
    unavailableMachines,
    awaitedApp,
    retryFailures,
  } = useAppCenter(projectId, agentIds);

  const [aiOpen, setAiOpen] = useState(false);
  // The open folder is the address's alone, so Back, a link and a click all agree on it; a
  // router update that React skips on the way (a Back pressed mid-transition) cannot leave a
  // second copy behind.
  const openFolderId = params.get(FOLDER_PARAM);
  // The departing folder stays mounted until it has folded back into its icon, Back included.
  const [displayedFolderId, setDisplayedFolderId] = useState(openFolderId);
  if (openFolderId !== null && displayedFolderId !== openFolderId)
    setDisplayedFolderId(openFolderId);
  /** Opening a folder from the grid adds an entry and another replaces it; closing leaves it. */
  const setOpenFolderId = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id === null) {
      next.delete(FOLDER_PARAM);
      returnToHostEntry(navigate, appCenterPath(next));
    } else {
      next.set(FOLDER_PARAM, id);
      setParams(next, { replace: openFolderId !== null });
    }
  };
  const [renaming, setRenaming] = useState<GridFolder | null>(null);
  const [errorOf, setErrorOf] = useState<GridApp | null>(null);
  const [restoring, setRestoring] = useState(false);
  /** The new-folder dialog's starting pick, while it is open. */
  const [newFolderPicked, setNewFolderPicked] = useState<string[] | null>(null);

  const grid = useMemo(
    () => (shortcuts === null ? null : arrange(shortcuts, layout)),
    [shortcuts, layout],
  );
  const titleOf = (shortcut: AppCenterShortcut) =>
    localizedText(locale, shortcut.title, shortcut.titleZh);

  /** Shows a new arrangement and stores it; one that changes nothing writes nothing. */
  const commit = (next: GridItem[], leaveFolder = false) => {
    if (openFolderId !== null && (leaveFolder || !next.some((item) => item.id === openFolderId)))
      setOpenFolderId(null);
    if (grid === null || sameArrangement(grid, next)) return;
    saveLayout(keepUnseenApps(layoutOf(next), layout, awaitedApp));
  };

  const onDrop = (dragged: Dragged, drop: Drop) => {
    if (grid === null) return;
    switch (drop.kind) {
      case "beside":
        commit(moveBeside(grid, dragged.id, drop.targetId, drop.side));
        return;
      case "into": {
        const target = findItem(grid, drop.targetId);
        if (target?.type === "folder") commit(moveIntoFolder(grid, dragged.id, target.id));
        else if (target?.type === "app")
          commit(
            makeFolder(grid, dragged.id, target.id, {
              id: newFolderId(grid),
              name: S.appCenter.newFolder,
            }),
          );
        return;
      }
      case "end":
        commit(moveToEnd(grid, dragged.id));
        return;
      case "outOfFolder":
        commit(takeOutOfFolder(grid, dragged.id), true);
        return;
    }
  };
  const drag = useTileDrag(onDrop);

  // The app open in a window, named by the query; an app no longer listed closes it.
  const openKey = params.get(OPEN_PARAM);
  const openApp = openKey === null || grid === null ? null : findItem(grid, openKey);
  const windowApp = openApp?.type === "app" && !openApp.shortcut.unavailable ? openApp : null;
  // A window leaving the address hands the focus back to the tile that opened it.
  const previousWindow = useRef(openKey);
  useLayoutEffect(() => {
    if (openKey === null && previousWindow.current !== null)
      document.getElementById(appTriggerId(previousWindow.current))?.focus({ preventScroll: true });
    previousWindow.current = openKey;
  }, [openKey]);

  const openWindow = (app: GridApp) => {
    const next = new URLSearchParams(params);
    next.set(OPEN_PARAM, app.id);
    setParams(next, { state: WINDOW_ENTRY_STATE });
  };
  /** Back to the grid or folder beneath: a step back over the app's own pages when it was pushed. */
  const closeWindow = () => {
    const next = new URLSearchParams(params);
    next.delete(OPEN_PARAM);
    returnToHostEntry(navigate, appCenterPath(next), {
      stepBack: (location.state as typeof WINDOW_ENTRY_STATE | null)?.appCenterWindow === true,
    });
  };

  const actions: GridActions | null =
    grid === null || projectId === null
      ? null
      : {
          grid,
          customized: layout !== null,
          titleOf,
          arrange: commit,
          open: openWindow,
          openFullScreen: (app) =>
            openFullPage(navigate, app.shortcut.path, appCenterPath(params), {
              fromWindow: false,
            }),
          showError: setErrorOf,
          viewInSettings: (app) =>
            void navigate(
              agentSettingsPath(
                app.shortcut.agentId,
                app.shortcut.machineId ?? null,
                "workbenches",
              ),
            ),
          removeFromAppCenter: (app) =>
            void api
              .setWorkbenchAppCenter(
                projectId,
                app.shortcut.agentId,
                app.shortcut.workbenchId,
                false,
                app.shortcut.machineId ?? null,
              )
              .then(() => refreshMachine(app.shortcut.machineId), toastApiError),
          openFolder: (folder) => setOpenFolderId(folder.id),
          newFolder: (app) => setNewFolderPicked(app === null ? [] : [app.id]),
          renameFolder: setRenaming,
          dissolveFolder: (folder) => commit(dissolveFolder(grid, folder.id)),
          restoreDefault: () => setRestoring(true),
        };

  const appTile = (app: GridApp, from: string | null) => (
    <AppTile
      key={app.id}
      app={app}
      inFolder={from !== null}
      title={titleOf(app.shortcut)}
      drag={drag.tileProps({ id: app.id, folder: false, from, canTakeInto: from === null })}
      mark={markOf(drag.pending, app.id)}
      lifted={drag.dragged?.id === app.id}
      menuItems={(close) => actions && <AppMenu app={app} actions={actions} close={close} />}
      onOpen={() => openWindow(app)}
    />
  );

  const displayedFolder =
    displayedFolderId === null || grid === null
      ? null
      : (grid.find(
          (item): item is GridFolder => item.type === "folder" && item.id === displayedFolderId,
        ) ?? null);

  const create = <AiCreateButtons size="sm" onAi={() => setAiOpen(true)} />;
  const headerActions = (
    <>
      <Button size="sm" onClick={() => setNewFolderPicked([])}>
        <GlyphIcon d={ICONS.folderPlus} />
        {S.appCenter.newFolderAction}
      </Button>
      {create}
    </>
  );

  return (
    <WindowStack className="h-full">
      <AppWindow shown={windowApp === null}>
        <div data-app-center-scroll className="h-full overflow-y-auto p-4 md:p-6">
          <div className="mx-auto flex min-h-full max-w-5xl flex-col">
            <PageHeader
              title={S.appCenter.title}
              {...(grid !== null && grid.length > 0 ? { actions: headerActions } : {})}
            />
            {error !== null && (
              <NoticeStrip tone="danger">
                {error}
                <Button variant="secondary" size="sm" onClick={reload}>
                  {S.workbenches.retryHistory}
                </Button>
              </NoticeStrip>
            )}
            {grid === null ? (
              error === null && (
                <ul className={GRID} aria-busy aria-label={S.appCenter.loading}>
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i} className="flex flex-col items-center gap-2 p-2">
                      <AppIconShape>
                        <Skeleton className="size-full" />
                      </AppIconShape>
                      <Skeleton className="h-3 w-16" />
                    </li>
                  ))}
                </ul>
              )
            ) : grid.length === 0 ? (
              <EmptyState
                title={S.appCenter.emptyTitle}
                description={S.appCenter.empty}
                action={create}
              />
            ) : (
              <ContextMenu
                label={S.appCenter.title}
                width={MENU_PX}
                items={(close) => actions && <GridMenu actions={actions} close={close} />}
              >
                {(target) => (
                  // The grid's empty space: its menu, and a drop there puts the item at the end.
                  <div
                    ref={target.ref}
                    {...target.props}
                    {...drag.areaProps({ kind: "end" }, () => true)}
                    className="relative flex-1 pb-6"
                  >
                    <ul className={GRID} aria-label={S.appCenter.title}>
                      {grid.map((item) =>
                        item.type === "app" ? (
                          appTile(item, null)
                        ) : (
                          <FolderTile
                            key={item.id}
                            folder={item}
                            expanded={openFolderId === item.id}
                            titleOf={titleOf}
                            drag={drag.tileProps({
                              id: item.id,
                              folder: true,
                              from: null,
                              canTakeInto: true,
                            })}
                            mark={markOf(drag.pending, item.id)}
                            lifted={drag.dragged?.id === item.id}
                            menuItems={(close) =>
                              actions && (
                                <FolderMenu folder={item} actions={actions} close={close} />
                              )
                            }
                            onOpen={() =>
                              setOpenFolderId(openFolderId === item.id ? null : item.id)
                            }
                          />
                        ),
                      )}
                    </ul>
                    {displayedFolder !== null && (
                      <FolderPanel
                        key={displayedFolder.id}
                        folder={displayedFolder}
                        open={openFolderId === displayedFolder.id}
                        onClose={() => setOpenFolderId(null)}
                        onExited={() => setDisplayedFolderId(null)}
                        draggingOut={drag.dragged?.from === displayedFolder.id}
                        onTakeOut={() => drag.dropNow({ kind: "outOfFolder" })}
                      >
                        {displayedFolder.apps.map((app) => appTile(app, displayedFolder.id))}
                      </FolderPanel>
                    )}
                  </div>
                )}
              </ContextMenu>
            )}
            {unavailableMachines.length > 0 && (
              <Notice
                tone="attention"
                className="mt-6"
                {...(retryFailures !== null
                  ? { retry: { label: S.common.retry, onClick: retryFailures } }
                  : {})}
              >
                {S.appCenter.machinesOffline(unavailableMachines.join(", "))}
              </Notice>
            )}
          </div>
        </div>
      </AppWindow>
      {windowApp !== null && projectId !== null && (
        <AppWindow shown>
          <AppCenterWindow
            key={windowApp.id}
            projectId={projectId}
            shortcut={windowApp.shortcut}
            title={titleOf(windowApp.shortcut)}
            onClose={closeWindow}
            onFullScreen={() =>
              openFullPage(navigate, windowApp.shortcut.path, appCenterPath(params), {
                fromWindow: true,
              })
            }
          />
        </AppWindow>
      )}
      <FolderNameDialog
        name={renaming?.name ?? null}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (renaming !== null && grid !== null) commit(renameFolder(grid, renaming.id, name));
        }}
      />
      {grid !== null && (
        <NewFolderDialog
          picked={newFolderPicked}
          grid={grid}
          titleOf={titleOf}
          onClose={() => setNewFolderPicked(null)}
          onCreate={(name, apps) => commit(groupApps(grid, apps, { id: newFolderId(grid), name }))}
        />
      )}
      <BuildErrorDialog
        error={
          errorOf === null
            ? null
            : { title: titleOf(errorOf.shortcut), message: errorOf.shortcut.error }
        }
        onClose={() => setErrorOf(null)}
      />
      <ConfirmModal
        open={restoring}
        title={S.appCenter.restoreTitle}
        tone="danger"
        confirmLabel={S.appCenter.restoreConfirm}
        cancelLabel={S.common.cancel}
        onClose={() => setRestoring(false)}
        onConfirm={() => {
          setRestoring(false);
          saveLayout(null);
        }}
      >
        {S.appCenter.restoreBody}
      </ConfirmModal>
      <AiCreateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={S.appCenter.aiCreateTitle}
        description={S.appCenter.aiCreateDescription}
        placeholder={S.appCenter.aiCreatePlaceholder}
        agents={agents}
        examples={aiExamples()}
        skills={APP_SKILLS}
        tail={S.appCenter.aiCreateTail}
      />
    </WindowStack>
  );
}
