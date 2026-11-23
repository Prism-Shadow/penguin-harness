/**
 * The rows of the sidebar's app list (main-sidebar-apps.tsx): the apps of the Agent the page works
 * under — the open conversation's own, on the machine it runs on (lib/page-agent.ts); once that
 * page is gone (an app's window covers it), the same while it is still the current Agent; else
 * the Project's current Agent on this server — then every other app still running in a window
 * (lib/running-apps.ts), marked so.
 *
 * - The Agent's apps are the ones its server lists for the sidebar (`GET …/workbenches?view=sidebar`:
 *   those that run, have a page and are shown in the sidebar, read from the files with nothing
 *   compiled). A server older than that listing answers with the Agent's whole list, and every
 *   workbench in it that runs and has a page is listed then.
 * - The list is read when the Agent changes and again on the server's news of a workbench of that
 *   Agent starting to load, loading or going away. Only the newest read's answer is applied: a
 *   slow answer for the Agent just left never lands on the one now shown, and switching Agents
 *   shows none of the last one's apps meanwhile.
 * - A read that fails keeps the rows shown. Safe mode reads nothing: no workbench runs there.
 */
import { useMemo } from "react";
import type { AppCenterShortcut, IconRef } from "@prismshadow/penguin-server/api";
import { locatedAppKey } from "../../lib/app-center-path";
import { useAgentApps } from "../../lib/use-agent-apps";
import { usePageAgent, type PageAgent } from "../../lib/page-agent";
import { useRunningApps, type RunningShortcut } from "../../lib/running-apps";
import { localizedText } from "../../lib/skill-use";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";

export interface SidebarAppRow {
  /** The App Center's key, `<machineId>:` first for a machine's app: the window's address. */
  key: string;
  agentId: string;
  workbenchId: string;
  machineId: string | null;
  /** In the reader's language. */
  title: string;
  icon: IconRef | null;
  /**
   * Shown in the sidebar by its Agent's setting, with the shortcut its window starts from; null
   * for an app listed only because it runs.
   */
  shortcut: RunningShortcut | null;
  /** The Agent's name, for an app listed only because it runs (its Agent is not the list's). */
  agentName: string | null;
  build: AppCenterShortcut["build"];
  /** Its window is open, shown or minimized. */
  running: boolean;
  /** Its window is the one on screen. */
  shown: boolean;
}

export function useSidebarApps(): {
  agent: PageAgent | null;
  rows: readonly SidebarAppRow[];
  /** Reads the Agent's list again (after a write the server announces anyway). */
  reload: () => void;
} {
  const { currentProject, currentAgent, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const page = usePageAgent();
  const { locale } = useLocale();
  const agent = useMemo<PageAgent | null>(() => {
    if (projectId === null) return null;
    if (
      page !== null &&
      page.agent.projectId === projectId &&
      (page.live || page.agent.agentId === currentAgent?.agentId)
    )
      return page.agent;
    return currentAgent === null
      ? null
      : { projectId, agentId: currentAgent.agentId, machineId: null };
  }, [projectId, page, currentAgent]);
  const { apps, read } = useAgentApps(agent);
  const running = useRunningApps();

  const rows = useMemo(() => {
    const open = new Map(running.map((app) => [app.key, app]));
    const own: SidebarAppRow[] = (apps ?? []).map((shortcut) => {
      const key = locatedAppKey(shortcut.agentId, shortcut.workbenchId, shortcut.machineId);
      const window = open.get(key);
      return {
        key,
        agentId: shortcut.agentId,
        workbenchId: shortcut.workbenchId,
        machineId: shortcut.machineId ?? null,
        title: localizedText(locale, shortcut.title, shortcut.titleZh),
        icon: shortcut.icon ?? null,
        shortcut,
        agentName: null,
        build: shortcut.build,
        running: window !== undefined,
        shown: window?.shown === true,
      };
    });
    const listed = new Set(own.map((row) => row.key));
    /** A running app's Agent by name: this server's list knows its own Agents best. */
    const nameOf = (app: (typeof running)[number]) => {
      const local =
        app.machineId === null ? agents.find((a) => a.agentId === app.agentId) : undefined;
      return local === undefined ? app.agentName : agentDisplayName(local);
    };
    const others: SidebarAppRow[] = running
      .filter((app) => !listed.has(app.key))
      .map((app) => ({
        key: app.key,
        agentId: app.agentId,
        workbenchId: app.workbenchId,
        machineId: app.machineId,
        title: app.title,
        icon: app.icon,
        shortcut: null,
        agentName:
          agent !== null && app.agentId === agent.agentId && app.machineId === agent.machineId
            ? null
            : nameOf(app),
        build: "ready",
        running: true,
        shown: app.shown,
      }));
    return [...own, ...others];
  }, [apps, running, locale, agents, agent]);

  return { agent, rows, reload: () => void read() };
}
