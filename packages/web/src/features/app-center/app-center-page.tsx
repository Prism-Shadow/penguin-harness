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
 * - A click (or Enter) opens the app windowed, over the grid (`?app=<agentId>/<workbenchId>`,
 *   `<machineId>:` first for a machine's); the tile's menu also opens it full screen, the full
 *   page whose exit comes back here. The window's minimize (and Back) returns to the grid with
 *   the app still running, and its tile marked so; a click on that tile brings back the same
 *   live window. Several apps can run at once, and they keep running while the viewer is on
 *   another page, because their windows live in a layer over the page area rather than here
 *   (app-center-windows.tsx, over the running set in lib/running-apps.ts, which other surfaces
 *   read too); only Close ends one.
 * - A tile whose app is building shows a turning ring and does not open; it turns live by itself
 *   when the build ends (use-app-center.ts follows the server's workbench news).
 * - Every tile, every folder and the grid's empty space have a context menu: right-click,
 *   Shift+F10 or the ContextMenu key, or press and hold on touch. It is also the keyboard's and
 *   touch's way to arrange the grid.
 *
 * With nothing to show, the page says what a workbench is and offers to have one built; there is
 * no manual path, so the AI button stands alone.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { WINDOW_ENTRY_STATE, WINDOW_PARAM } from "../../lib/app-window-address";
import { keepListedApps, launchApp, useRunningApps } from "../../lib/running-apps";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { AiCreateButtons, AiCreateModal } from "../ai-create";
import type { AiExample } from "../ai-create";
import { AppTile, FolderTile, MENU_PX, type TileMark } from "./app-tile";
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
  type LocatedShortcut,
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
  const folderParam = params.get("folder");
  // Direct interaction must be visible in the same frame; the router also accepts browser Back
  // and links from full-screen workbenches, which can arrive in a deferred React transition.
  const [openFolderId, setSelectedFolderId] = useState(folderParam);
  useLayoutEffect(() => setSelectedFolderId(folderParam), [folderParam]);
  useLayoutEffect(() => {
    // A rapid browser Back can skip the intermediate router render entirely. Its destination
    // may have the same folderParam as the last committed render, despite our local open.
    const onPop = () =>
      setSelectedFolderId(new URLSearchParams(window.location.search).get("folder"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Keep the departing folder mounted until its icons reach their previews, including on Back.
  const [displayedFolderId, setDisplayedFolderId] = useState(openFolderId);
  if (openFolderId !== null && displayedFolderId !== openFolderId)
    setDisplayedFolderId(openFolderId);
  const setOpenFolderId = (id: string | null) => {
    setSelectedFolderId(id);
    const next = new URLSearchParams(params);
    if (id === null) next.delete("folder");
    else next.set("folder", id);
    if (id === null && location.state?.fromAppGrid) void navigate(-1);
    else
      setParams(next, {
        replace: openFolderId !== null,
        state: {
          fromAppGrid: id !== null && (openFolderId === null || location.state?.fromAppGrid),
        },
      });
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

  // The running apps of this Project; the window of the one the query names covers the grid.
  const running = useRunningApps();
  const runningIds = useMemo(() => new Set(running.map((app) => app.key)), [running]);
  const openKey = params.get(WINDOW_PARAM);
  const openApp = openKey === null || grid === null ? null : findItem(grid, openKey);
  const windowApp = openApp?.type === "app" && !openApp.shortcut.unavailable ? openApp : null;
  const windowShown = openKey !== null && runningIds.has(openKey);

  // An app the list no longer has ends: the App Center is the one place an app is opened from, so
  // one it no longer lists could not be brought back. The rest take the shortcut it gives now.
  useEffect(() => {
    if (projectId === null || grid === null) return;
    const listed = new Map<string, LocatedShortcut>();
    for (const item of grid) {
      if (item.type === "app") listed.set(item.id, item.shortcut);
      else for (const app of item.apps) listed.set(app.id, app.shortcut);
    }
    keepListedApps(projectId, listed);
  }, [projectId, grid]);

  // An address that names a listed app starts it (a link, a reload, Forward after a close), before
  // the frame is painted. Keyed on the app's id rather than on the running set or the shortcut:
  // a Close that has ended the app but not yet left the address must not start it again.
  const windowAppId = windowApp?.id ?? null;
  useLayoutEffect(() => {
    if (projectId !== null && windowApp !== null)
      launchApp({ key: windowApp.id, projectId, shortcut: windowApp.shortcut });
  }, [projectId, windowAppId]);

  const openWindow = (app: GridApp) => {
    if (projectId !== null) launchApp({ key: app.id, projectId, shortcut: app.shortcut });
    const next = new URLSearchParams(params);
    next.set(WINDOW_PARAM, app.id);
    setParams(next, { state: WINDOW_ENTRY_STATE });
  };
  const openFullScreen = (app: GridApp, returnTo: string) =>
    void navigate(app.shortcut.path, { state: { returnTo } });

  const actions: GridActions | null =
    grid === null || projectId === null
      ? null
      : {
          grid,
          customized: layout !== null,
          titleOf,
          arrange: commit,
          open: openWindow,
          isRunning: (app) => runningIds.has(app.id),
          openFullScreen: (app) => openFullScreen(app, APP_CENTER_PATH + location.search),
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
      running={runningIds.has(app.id)}
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
      <AppWindow shown={!windowShown}>
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
                            running={item.apps.filter((app) => runningIds.has(app.id)).length}
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
