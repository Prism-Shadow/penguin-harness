/**
 * One workflow's page as the whole app: /app/:projectId/:agentId/:workflowId.
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
import { WORKFLOW_UPDATED_EVENT, workflowTabsOf, type WorkflowTab } from "../../lib/workflow-tabs";
import { rememberSelection } from "../../state/project";
import { AppPalette } from "../palette/app-palette";
import { WorkflowFrame } from "./workflow-tabs";

export function WorkflowAppPage() {
  const params = useParams();
  const projectId = params["projectId"] ?? "";
  const agentId = params["agentId"] ?? "";
  const workflowId = params["workflowId"] ?? "";
  const navigate = useNavigate();
  const [tab, setTab] = useState<WorkflowTab | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getWorkflows(projectId, agentId);
        if (!alive) return;
        setTab(workflowTabsOf(res.workflows).find((t) => t.workflowId === workflowId) ?? null);
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
    return () => {
      alive = false;
      window.removeEventListener(WORKFLOW_UPDATED_EVENT, onUpdated);
    };
  }, [projectId, agentId, workflowId]);

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
    <div className="h-full w-full bg-white dark:bg-gray-950">
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
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {tab === undefined && failure === null
            ? S.workflows.loadingHistory
            : (failure ?? S.workflows.noSuchPage)}
          <br />
          {S.workflows.exitHint}
        </div>
      )}
      <AppPalette extra={exit} />
    </div>
  );
}
