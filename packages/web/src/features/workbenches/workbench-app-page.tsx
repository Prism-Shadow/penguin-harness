/**
 * One workbench page as the whole app: /app/:projectId/:agentId/:workbenchId[/:tabKey] — the
 * tab that key names, or the workbench's first tab without one.
 *
 * No sidebar, no chat, no tab strip — the page fills the window, which is what
 * `penguin web --app …` opens and what a tab's "fill the app" action navigates to. There is
 * a floating exit control and the command palette (the `palette.toggle` chord, re-raised
 * from inside the page by forwardFrameKeys) both offer "Exit full page", which lands
 * on the same Agent’s workbench tab. The route sits outside the app shell (no ProjectProvider), so the exit
 * remembers the Project and Agent the way the shell does — its localStorage keys — before
 * navigating.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Button, type PaletteAction } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { S } from "../../lib/strings";
import {
  appPageTab,
  WORKBENCH_UPDATED_EVENT,
  workbenchTabsOf,
  type WorkbenchTab,
} from "../../lib/workbench-tabs";
import { rememberSelection } from "../../state/project";
import { AppPalette } from "../palette";
import { openUserEvents } from "../../api/sse";
import { WorkbenchFrame } from "./workbench-tabs";

export function WorkbenchAppPage() {
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
  const [tab, setTab] = useState<WorkbenchTab | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const paletteShortcut = useShortcutLabel("palette.toggle");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getWorkbenches(projectId, agentId, machineId);
        if (!alive) return;
        setTab(appPageTab(workbenchTabsOf(res.workbenches, machineId), workbenchId, tabKey));
        setFailure(null);
      } catch (err) {
        if (alive) setFailure(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<{ projectId: string; agentId: string }>).detail;
      if (d.projectId === projectId && d.agentId === agentId) void load();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    // This route is outside the app shell, so the provider that usually holds the event
    // stream open (and raises the event above) is not mounted: without a stream of its own,
    // a page shown as the whole app would never notice its workbench being edited or removed.
    const conn = openUserEvents({
      onOmniMessage: () => undefined,
      onServerEvent: (ev) => {
        if (ev.type !== "workbench_updated" && ev.type !== "workbench_removed") return;
        if (ev.projectId === projectId && ev.agentId === agentId) void load();
      },
    });
    return () => {
      alive = false;
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
      conn.close();
    };
  }, [projectId, agentId, workbenchId, tabKey, machineId]);

  const exit = useMemo<PaletteAction[]>(
    () => [
      {
        id: "exit-full-page",
        label: S.workbenches.exitFullPage,
        keywords: ["exit", "leave", "chat", "full page", "app"],
        run: () => {
          rememberSelection(projectId, agentId);
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
    [projectId, agentId, navigate, returnTo, tab?.tabId, workbenchId, tabKey, machineId],
  );

  return (
    <div className="relative h-full w-full bg-white pt-[env(titlebar-area-height,0px)] dark:bg-gray-950">
      {/* A list request that fails after the page is up says so over it, rather than leaving
          a frame that quietly stopped following the workbench. */}
      {tab && failure !== null && (
        <div
          className="absolute inset-x-0 top-[env(titlebar-area-height,0px)] z-10 bg-amber-50 px-3 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
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
              : (failure ?? S.workbenches.noSuchPage)}
          </span>
          <span>{S.workbenches.exitHint(paletteShortcut)}</span>
        </div>
      )}
      <div className="fixed right-4 bottom-4 z-40">
        <Button variant="secondary" size="sm" onClick={() => exit[0]!.run()}>
          {S.workbenches.exitFullPageButton}
        </Button>
      </div>
      <AppPalette extra={exit} />
    </div>
  );
}
