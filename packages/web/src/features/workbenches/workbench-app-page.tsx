/**
 * One workbench page as the whole app: /app/:projectId/:agentId/:workbenchId[/:tabKey] — the
 * tab that key names, or the workbench's first tab without one.
 *
 * No sidebar, no chat — the page fills the window, which is what `penguin web --app …` opens and
 * what a window's "Open full screen" (or the page's own request to fill the app) navigates to. A
 * floating exit ball (exit-ball.tsx: it drags to either edge and tucks away into a handle there)
 * and the command palette (the `palette.toggle` chord, re-raised from inside the page by
 * forwardFrameKeys) both offer the exit. It goes back to where the page was opened from: the
 * App Center's grid or folder for a tile's "Open full screen", and the app's window, at the page
 * shown, for the window's — the window, too, when nothing opened it (a link, `penguin web
 * --app`). Leaving the shell ended the running apps, so the exit starts this one again before it
 * lands on its window. The route sits outside the app shell (no ProjectProvider), so the exit
 * remembers the Project and Agent the way the shell does — its localStorage keys — before
 * navigating.
 */
import { useMemo } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import { useInstallManifest } from "../../lib/workbench-tabs";
import { rememberSelection } from "../../state/project";
import { APP_CENTER_PATH, isAppCenterPath, locatedAppKey } from "../../lib/app-center-path";
import { windowOfPath, windowSearch } from "../../lib/app-window-address";
import { returnToHostEntry } from "../../lib/host-history";
import { launchApp } from "../../lib/running-apps";
import { shortcutOfWorkbench } from "../../lib/workbench-shortcut";
import { useSafeMode } from "../../rescue/safe-mode";
import { usePaletteActions } from "../../lib/palette-actions";
import { WorkbenchExitBall } from "./exit-ball";
import { useAppPageTab } from "./use-app-page-tab";
import { useDocumentTitle } from "../../lib/use-document-title";
import { WorkbenchFrame } from "./workbench-frame";

export function WorkbenchAppPage() {
  const safe = useSafeMode();
  const params = useParams();
  const projectId = params["projectId"] ?? "";
  const agentId = params["agentId"] ?? "";
  const workbenchId = params["workbenchId"] ?? "";
  const tabKey = params["tabKey"];
  // A workbench of an Agent that lives on a machine is asked of that machine (`?machine=<id>`).
  const machineId = useSearchParams()[0].get("machine");
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const key = locatedAppKey(agentId, workbenchId, machineId);
  /** The exit lands on the app's window: the one it was opened from, or a new one. */
  const toWindow = typeof returnTo !== "string" || windowOfPath(returnTo) === key;
  const { tab, workbench, off, failure } = useAppPageTab({
    projectId,
    agentId,
    workbenchId,
    tabKey,
    machineId,
    // This route is outside the app shell, so it holds its own event stream open.
    ownEvents: true,
    enabled: !safe,
  });
  const paletteShortcut = useShortcutLabel("palette.toggle");
  // The page is the app: the browser tab carries the tab's own name (the manifest's name is
  // the same title), not the main app's.
  useDocumentTitle(tab?.title ?? null);

  // This page is its own installable app: its manifest link names THIS tab's manifest while
  // mounted (one app per tab), the workbench's when no tab key is in the route — a remote
  // machine's workbench adds the machine query the route carries. On unmount the main app's
  // literal link is restored, never the href found on arrival (on a server-rewritten page
  // that href is already a workbench manifest — keeping it would leave the install surface
  // on the workbench). The hook lives in lib/workbench-tabs with the rest of the face.
  useInstallManifest(projectId, agentId, workbenchId, tabKey, machineId);

  const exit = useMemo<PaletteAction[]>(
    () => [
      {
        id: "exit-full-page",
        label:
          toWindow || !isAppCenterPath(returnTo)
            ? S.workbenches.exitToWindow
            : S.workbenches.exitToAppCenter,
        keywords: ["exit", "leave", "window", "full page", "app"],
        run: () => {
          rememberSelection(projectId, agentId);
          if (!toWindow && typeof returnTo === "string") {
            returnToHostEntry(navigate, returnTo);
            return;
          }
          // The window shows the page shown here, and the app is started again for it.
          if (workbench !== null) {
            const shortcut = shortcutOfWorkbench(
              projectId,
              { agentId, agentName: agentId },
              workbench,
              machineId,
            );
            launchApp({
              key,
              projectId,
              shortcut: tab ? { ...shortcut, tab: tab.key } : shortcut,
            });
          }
          if (typeof returnTo === "string") returnToHostEntry(navigate, returnTo);
          else void navigate(APP_CENTER_PATH + windowSearch(key), { replace: true });
        },
      },
    ],
    [projectId, agentId, machineId, navigate, returnTo, toWindow, key, workbench, tab],
  );

  usePaletteActions(exit);

  if (safe) return <div role="status">{S.rescue.marker}</div>;

  return (
    // A window of its own (`isolate`): its layers order only among themselves, under the
    // palette and every other overlay in the portal root. The theme's canvas shows through a
    // page that paints no background of its own.
    <div className="relative isolate h-full w-full bg-canvas pt-[var(--window-band-height,0px)]">
      {/* A list request that fails after the page is up says so over it, rather than leaving
          a frame that quietly stopped following the workbench. */}
      {tab && failure !== null && (
        <div
          className="absolute inset-x-0 top-[var(--window-band-height,0px)] z-window-overlay bg-amber-50 px-3 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          role="status"
        >
          {failure}
        </div>
      )}
      {tab ? (
        <WorkbenchFrame tab={tab} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <span>
            {tab === undefined && failure === null
              ? S.workbenches.loadingPage
              : (failure ?? (off ? S.workbenches.offPage : S.workbenches.noSuchPage))}
          </span>
          <span>{S.workbenches.exitHint(paletteShortcut)}</span>
        </div>
      )}
      <WorkbenchExitBall label={S.workbenches.exitFullPageButton} onExit={() => exit[0]!.run()} />
    </div>
  );
}
