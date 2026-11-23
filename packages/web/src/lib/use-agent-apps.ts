import { useCallback, useEffect, useRef, useState } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { useSafeMode } from "../rescue/safe-mode";
import type { PageAgent } from "./page-agent";
import type { RunningShortcut } from "./running-apps";
import { shortcutOfWorkbench } from "./workbench-shortcut";
import {
  runningWorkbenches,
  WORKBENCH_BUILDING_EVENT,
  WORKBENCH_UPDATED_EVENT,
  workbenchAppPath,
  type WorkbenchUpdatedDetail,
} from "./workbench-tabs";

/** The Agent's sidebar shortcuts, as its server lists them; null until the first answer. */
export function useAgentApps(agent: PageAgent | null) {
  const safe = useSafeMode();
  const scope =
    agent === null ? null : JSON.stringify([agent.projectId, agent.agentId, agent.machineId]);
  const [loaded, setLoaded] = useState<{ scope: string; apps: RunningShortcut[] } | null>(null);
  /** The newest read: an older one's answer is dropped. */
  const asked = useRef(0);
  const projectId = agent?.projectId ?? null;
  const agentId = agent?.agentId ?? null;
  const machineId = agent?.machineId ?? null;

  const read = useCallback(async () => {
    const mine = ++asked.current;
    if (safe || scope === null || projectId === null || agentId === null) return;
    try {
      const answer = await api.getSidebarApps(projectId, agentId, machineId);
      if (asked.current !== mine) return;
      const apps =
        "apps" in answer
          ? answer.apps.map((app) => located(projectId, app, machineId))
          : runningWorkbenches(answer.workbenches)
              .filter((w) => w.tabs.length > 0)
              .map((w) =>
                shortcutOfWorkbench(projectId, { agentId, agentName: agentId }, w, machineId),
              );
      setLoaded({ scope, apps });
    } catch {
      // The list is a convenience beside the conversations: a failed read leaves it as it was.
    }
  }, [safe, scope, projectId, agentId, machineId]);

  useEffect(() => {
    void read();
    return () => {
      asked.current++;
    };
  }, [read]);

  useEffect(() => {
    const news = (e: Event) => {
      const d = (e as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (d.projectId === projectId && d.agentId === agentId && (d.machineId ?? null) === machineId)
        void read();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, news);
    window.addEventListener(WORKBENCH_BUILDING_EVENT, news);
    return () => {
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, news);
      window.removeEventListener(WORKBENCH_BUILDING_EVENT, news);
    };
  }, [projectId, agentId, machineId, read]);

  return { apps: !safe && loaded !== null && loaded.scope === scope ? loaded.apps : null, read };
}

/** A shortcut as the window takes it: on its machine, its full page asked of that machine. */
function located(
  projectId: string,
  app: AppCenterShortcut,
  machineId: string | null,
): RunningShortcut {
  if (machineId === null) return app;
  return {
    ...app,
    machineId,
    path: workbenchAppPath(projectId, app.agentId, app.workbenchId, app.tab, machineId),
  };
}
