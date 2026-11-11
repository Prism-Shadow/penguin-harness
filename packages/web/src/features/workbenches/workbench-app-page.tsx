/**
 * One workbench page as the whole app: /app/:projectId/:agentId/:workbenchId[/:tabKey] — the
 * tab that key names, or the workbench's first tab without one.
 *
 * No sidebar, no chat, no tab strip — the page fills the window, which is what
 * `penguin web --app …` opens and what a tab's "fill the app" action navigates to. There is
 * a floating exit control and the command palette (the `palette.toggle` chord, re-raised
 * from inside the page by forwardFrameKeys) both offer "Exit full page", which lands
 * on the same Agent’s workbench tab — or back on the App Center, when the page was opened
 * from one of its tiles. The route sits outside the app shell (no ProjectProvider), so the exit
 * remembers the Project and Agent the way the shell does — its localStorage keys — before
 * navigating.
 */
import { useMemo } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Button, type PaletteAction } from "@prismshadow/penguin-ui";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import { rememberSelection } from "../../state/project";
import { isAppCenterPath } from "../../lib/app-center-path";
import { useSafeMode } from "../../rescue/safe-mode";
import { usePaletteActions } from "../../lib/palette-actions";
import { useAppPageTab } from "./use-app-page-tab";
import { WorkbenchFrame } from "./workbench-tabs";

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
  const toAppCenter = isAppCenterPath(returnTo);
  const { tab, off, failure } = useAppPageTab({
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

  const exit = useMemo<PaletteAction[]>(
    () => [
      {
        id: "exit-full-page",
        label: toAppCenter ? S.workbenches.exitToAppCenter : S.workbenches.exitFullPage,
        keywords: ["exit", "leave", "chat", "full page", "app"],
        run: () => {
          rememberSelection(projectId, agentId);
          if (isAppCenterPath(returnTo)) {
            void navigate(returnTo);
            return;
          }
          const destination =
            typeof returnTo === "string" && /^\/chat(?:\/[^/?#]+)?(?:\?[^#]*)?$/.test(returnTo)
              ? returnTo
              : "/chat/new";
          void navigate(destination, {
            state: {
              agentId,
              ...(!returnTo ? { workspace: "", ...(machineId ? { machineId } : {}) } : {}),
              workbench: {
                projectId,
                agentId,
                tabId: tab?.tabId ?? `${workbenchId}/${tabKey ?? "main"}`,
                machineId,
              },
            },
          });
        },
      },
    ],
    [
      projectId,
      agentId,
      navigate,
      returnTo,
      toAppCenter,
      tab?.tabId,
      workbenchId,
      tabKey,
      machineId,
    ],
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
        <WorkbenchFrame
          projectId={projectId}
          agentId={agentId}
          tab={tab}
          bare
          onChanged={() => undefined}
          onRemoved={() => exit[0]!.run()}
        />
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
      <div className="fixed right-4 bottom-4 z-window-overlay">
        <Button variant="secondary" size="sm" onClick={() => exit[0]!.run()}>
          {S.workbenches.exitFullPageButton}
        </Button>
      </div>
    </div>
  );
}
