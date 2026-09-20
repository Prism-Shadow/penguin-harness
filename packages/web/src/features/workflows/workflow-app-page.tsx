/**
 * One workflow page as the whole app: /app/:projectId/:agentId/:workflowId[/:tabKey] — the
 * tab that key names, or the workflow's first tab without one.
 *
 * No sidebar, no chat, no tab strip — the page fills the window, which is what
 * `penguin web --app …` opens and what a tab's "fill the app" action navigates to. There is
 * deliberately no chrome to leave by: the command palette (Ctrl+P / Ctrl+Shift+P, both, in
 * case the page takes one) carries the way out, "Exit full page", which lands on the chat of
 * that same Agent. The route sits outside the app shell (no ProjectProvider), so the exit
 * remembers the Project and Agent the way the shell does — its localStorage keys — before
 * navigating.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import * as api from "../../api/endpoints";
import type { PaletteAction } from "../../lib/command-palette";
import { S } from "../../lib/strings";
import {
  appPageTab,
  WORKFLOW_UPDATED_EVENT,
  workflowTabsOf,
  type WorkflowTab,
} from "../../lib/workflow-tabs";
import { rememberSelection } from "../../state/project";
import { AppPalette } from "../palette/app-palette";
import { openUserEvents } from "../../api/sse";
import { WorkflowFrame } from "./workflow-tabs";

export function WorkflowAppPage() {
  const params = useParams();
  const projectId = params["projectId"] ?? "";
  const agentId = params["agentId"] ?? "";
  const workflowId = params["workflowId"] ?? "";
  const tabKey = params["tabKey"];
  const navigate = useNavigate();
  const [tab, setTab] = useState<WorkflowTab | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getWorkflows(projectId, agentId);
        if (!alive) return;
        setTab(appPageTab(workflowTabsOf(res.workflows), workflowId, tabKey));
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
    window.addEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
    // This route is outside the app shell, so the provider that usually holds the event
    // stream open (and raises the event above) is not mounted: without a stream of its own,
    // a page shown as the whole app would never notice its workflow being edited or removed.
    const conn = openUserEvents({
      onOmniMessage: () => undefined,
      onServerEvent: (ev) => {
        if (ev.type !== "workflow_updated" && ev.type !== "workflow_removed") return;
        if (ev.projectId === projectId && ev.agentId === agentId) void load();
      },
    });
    return () => {
      alive = false;
      window.removeEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
      conn.close();
    };
  }, [projectId, agentId, workflowId, tabKey]);

  const exit = useMemo<PaletteAction[]>(
    () => [
      {
        id: "exit-full-page",
        label: S.workflows.exitFullPage,
        keywords: ["exit", "leave", "chat", "full page", "app"],
        run: () => {
          rememberSelection(projectId, agentId);
          void navigate("/chat");
        },
      },
    ],
    [projectId, agentId, navigate],
  );

  return (
    <div className="relative h-full w-full bg-white dark:bg-gray-950">
      {/* A list request that fails after the page is up says so over it, rather than leaving
          a frame that quietly stopped following the workflow. */}
      {tab && failure !== null && (
        <div
          className="absolute inset-x-0 top-0 z-10 bg-amber-50 px-3 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          role="status"
        >
          {failure}
        </div>
      )}
      {tab ? (
        <WorkflowFrame
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
              ? S.workflows.loadingPage
              : (failure ?? S.workflows.noSuchPage)}
          </span>
          <span>{S.workflows.exitHint}</span>
        </div>
      )}
      <AppPalette extra={exit} />
    </div>
  );
}
