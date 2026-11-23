/**
 * The App Center shortcut a workbench makes, read from its listing (`WorkbenchInfo`) where no
 * shortcut list holds it: the Agent's settings row opening the app's window, and the sidebar's app
 * list on a server older than its own listing. It reads as the server's does
 * (packages/server/src/workbenches/app-center.ts `shortcutOf`): the declared title, else the first
 * page's, else the package name; the declared page, else the first; the full page at that page,
 * on the machine the Agent lives on.
 */
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import type { RunningShortcut } from "./running-apps";
import { workbenchAppPath } from "./workbench-tabs";

export function shortcutOfWorkbench(
  projectId: string,
  agent: { agentId: string; agentName: string },
  workbench: WorkbenchInfo,
  machineId: string | null,
): RunningShortcut {
  const first = workbench.tabs[0];
  const declared = workbench.appCenter;
  const titleZh = declared?.titleZh ?? first?.titleZh;
  const tab = declared?.tab ?? first?.key;
  return {
    agentId: agent.agentId,
    agentName: agent.agentName,
    workbenchId: workbench.id,
    title: declared?.title ?? first?.title ?? workbench.name,
    ...(titleZh !== undefined ? { titleZh } : {}),
    ...(workbench.icon !== undefined ? { icon: workbench.icon } : {}),
    path: workbenchAppPath(projectId, agent.agentId, workbench.id, declared?.tab, machineId),
    ...(tab !== undefined ? { tab } : {}),
    build: workbench.error !== null ? "failed" : "ready",
    ...(workbench.error !== null ? { error: workbench.error } : {}),
    ...(workbench.showInSidebar !== undefined ? { showInSidebar: workbench.showInSidebar } : {}),
    ...(machineId !== null ? { machineId } : {}),
  };
}
