/**
 * The App Center's windows, one per running app (lib/running-apps.ts), hosted in a layer over the
 * page area (a `WebAppModule.layers` contribution with `area: "page"`) rather than inside the App
 * Center page. The page unmounts when the viewer goes to another one; this layer does not, so an
 * app minimized there keeps running meanwhile and is the same live window when it comes back.
 *
 * A window is in front only on the App Center, while `?app=` names it. Every other one is
 * minimized: mounted and laid out at the area's size, but neither painted nor reachable
 * (`AppWindow`), so what runs in its frame — its state, timers, sound and connections — carries
 * on. Minimize and Back leave a window alike, back to the page it was opened or brought back from
 * (lib/app-window-address.ts); Close ends the app and unmounts its frame. Switching Project ends
 * the previous Project's apps, and leaving the app shell (the full page, signing out, a reload)
 * unmounts this layer and ends them all, so nothing is ever listed as running with nothing behind
 * it.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { AppWindow } from "@prismshadow/penguin-ui";
import { APP_CENTER_PATH } from "../../lib/app-center-path";
import { leaveWindow, windowInFront } from "../../lib/app-window-address";
import {
  closeAllApps,
  closeApp,
  keepProjectApps,
  useRunningAppRecords,
} from "../../lib/running-apps";
import { localizedText } from "../../lib/skill-use";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { AppCenterWindow } from "./app-center-window";

export function AppCenterWindows() {
  const apps = useRunningAppRecords();
  const projectId = useProject().currentProject?.projectId ?? null;
  const { locale } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const front = windowInFront(location);

  useEffect(() => {
    if (projectId !== null) keepProjectApps(projectId);
  }, [projectId]);
  useEffect(() => closeAllApps, []);

  const leave = () => leaveWindow(navigate, location);
  return (
    <>
      {apps.map((app) =>
        app.projectId !== projectId ? null : (
          <AppWindow key={app.key} shown={app.key === front}>
            <AppCenterWindow
              projectId={app.projectId}
              shortcut={app.shortcut}
              title={localizedText(locale, app.shortcut.title, app.shortcut.titleZh)}
              onMinimize={leave}
              onFullScreen={() =>
                void navigate(app.shortcut.path, {
                  state: { returnTo: `${APP_CENTER_PATH}${location.search}` },
                })
              }
              onClose={() => {
                closeApp(app.key);
                leave();
              }}
            />
          </AppWindow>
        ),
      )}
    </>
  );
}
