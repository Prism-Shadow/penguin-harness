/**
 * Each running app keeps one live window in the shell across route changes, including when
 * minimized or moved between panes. Closing its page ends the app and removes its frame;
 * closing a Session page beside it leaves it running. Switching Project or leaving the shell
 * releases these windows.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { AppWindow } from "@prismshadow/penguin-ui";
import {
  APP_CENTER_PATH,
  leaveWindow,
  windowAt,
  windowInFront,
  openFullPage,
  closeAllApps,
  closeApp,
  keepProjectApps,
  useRunningAppRecords,
  type RunningAppRecord,
  localizedText,
  systemAppFullPage,
  useLocale,
  useProject,
  PageSlot,
  sessionAppPair,
  usePageWorkspace,
} from "@prismshadow/penguin-web/internal";

import { appTriggerId } from "./app-tile";
import { AppCenterWindow } from "./app-center-window";

export function AppCenterWindows() {
  const workspace = usePageWorkspace();
  const apps = useRunningAppRecords();
  const projectId = useProject().currentProject?.projectId ?? null;
  const { locale } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const front = windowInFront(location);
  const previousFront = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = previousFront.current;
    previousFront.current = front;
    if (previous !== null && front === null && location.pathname === APP_CENTER_PATH) {
      const ticket = requestAnimationFrame(() =>
        document.getElementById(appTriggerId(previous))?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(ticket);
    }
  }, [front, location.pathname]);

  useEffect(() => {
    if (projectId !== null) keepProjectApps(projectId);
  }, [projectId]);
  useEffect(() => closeAllApps, []);

  const leave = () => leaveWindow(navigate, location);
  const docked = workspace && sessionAppPair(workspace.layout)?.app;
  /** The app's full page: a system app drawn in an iframe opens there where its window was. */
  const fullPageOf = ({ projectId: project, shortcut }: RunningAppRecord) =>
    shortcut.system?.frame !== undefined
      ? systemAppFullPage(project, shortcut.workbenchId, windowAt(location))
      : shortcut.path;
  return (
    <>
      {apps.map((app) =>
        app.projectId !== projectId ? null : (
          <PageSlot key={app.key} id={"app:" + app.key} keepRunning>
            <AppWindow
              shown={
                workspace
                  ? !!workspace.current && workspace.layout.visible.includes("app:" + app.key)
                  : app.key === front
              }
            >
              <AppCenterWindow
                appKey={app.key}
                projectId={app.projectId}
                shortcut={app.shortcut}
                title={localizedText(locale, app.shortcut.title, app.shortcut.titleZh)}
                exitFullScreen={
                  workspace?.current?.id === "app:" + app.key ? workspace.exitFullScreen : undefined
                }
                onFullScreen={(path) => {
                  if (docked?.id === "app:" + app.key) {
                    if (!workspace?.exitFullScreen) workspace?.fullScreen(docked);
                    return;
                  }
                  openFullPage(
                    navigate,
                    app.shortcut.system?.frame !== undefined ? fullPageOf(app) : path,
                    `${APP_CENTER_PATH}${location.search}`,
                    {
                      fromWindow: true,
                    },
                  );
                }}
                onGone={() => {
                  closeApp(app.key);
                  if (workspace) workspace.close("app:" + app.key);
                  else if (app.key === front) leave();
                }}
              />
            </AppWindow>
          </PageSlot>
        ),
      )}
    </>
  );
}
