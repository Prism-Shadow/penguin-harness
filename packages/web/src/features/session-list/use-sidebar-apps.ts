import { useMemo } from "react";
import type { AppCenterShortcut, IconRef } from "@prismshadow/penguin-server/api";
import type { OpenPage } from "../../lib/page-layout";
import { SYSTEM_AGENT_ID } from "../../lib/builtin-agents";
import { systemAppKey, useSystemApps, type SystemShortcut } from "../../lib/system-apps";
import { systemShortcutsOf } from "../app-center";
import { usePageAgent } from "../../lib/page-agent";
import { useRunningAppRecords } from "../../lib/running-apps";
import { localizedText } from "../../lib/skill-use";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";

export interface SidebarAppRow {
  key: string;
  page: OpenPage;
  agentId: string;
  workbenchId: string;
  machineId: string | null;
  title: string;
  icon: IconRef | null;
  system?: SystemShortcut;
  agentName: string | null;
  build: AppCenterShortcut["build"];
}

/** Page membership owns the list. A running window or a permitted native app supplies its label. */
export function useSidebarApps(pages: readonly OpenPage[] | undefined) {
  const { currentProject, currentAgent, agents } = useProject();
  const projectId = currentProject?.projectId;
  const pageAgent = usePageAgent();
  const agent =
    pageAgent &&
    pageAgent.agent.projectId === projectId &&
    (pageAgent.live || pageAgent.agent.agentId === currentAgent?.agentId)
      ? pageAgent.agent
      : currentAgent && projectId
        ? { projectId, agentId: currentAgent.agentId, machineId: null }
        : null;
  const systems = useSystemApps();
  const running = useRunningAppRecords();
  const { locale } = useLocale();
  const agentId = agent?.agentId;
  const agentMachine = agent?.machineId;
  const rows = useMemo(() => {
    if (!projectId || !pages) return [];
    const installedSystems = new Map(
      systemShortcutsOf(systems, projectId).map((shortcut) => [
        systemAppKey(shortcut.workbenchId),
        shortcut,
      ]),
    );
    const windows = new Map(
      running.filter((app) => app.projectId === projectId).map((app) => [app.key, app.shortcut]),
    );
    const rows: SidebarAppRow[] = [];
    for (const page of pages) {
      if (page.kind !== "window" && page.kind !== "system") continue;
      const key = page.id.slice(4);
      const shortcut = key.startsWith(SYSTEM_AGENT_ID + "/")
        ? installedSystems.get(key)
        : windows.get(key);
      if (!shortcut) continue;
      const machineId = shortcut.machineId ?? null;
      const own = shortcut.agentId === agentId && machineId === agentMachine;
      const local =
        !own && machineId === null
          ? agents.find((item) => item.agentId === shortcut.agentId)
          : undefined;
      rows.push({
        key,
        page,
        agentId: shortcut.agentId,
        workbenchId: shortcut.workbenchId,
        machineId,
        title: localizedText(locale, shortcut.title, shortcut.titleZh),
        icon: shortcut.icon ?? null,
        ...(shortcut.system && { system: shortcut.system }),
        agentName:
          shortcut.system || own ? null : local ? agentDisplayName(local) : shortcut.agentName,
        build: shortcut.build,
      });
    }
    return rows;
  }, [projectId, pages, systems, running, locale, agents, agentId, agentMachine]);
  return { agent, rows };
}
