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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppCenterShortcut, IconRef } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { locatedAppKey } from "../../lib/app-center-path";
import { usePageAgent } from "../../lib/page-agent";
import { useRunningApps, type RunningShortcut } from "../../lib/running-apps";
import { localizedText } from "../../lib/skill-use";
import { shortcutOfWorkbench } from "../../lib/workbench-shortcut";
import {
  runningWorkbenches,
  WORKBENCH_BUILDING_EVENT,
  WORKBENCH_UPDATED_EVENT,
  workbenchAppPath,
  type WorkbenchUpdatedDetail,
} from "../../lib/workbench-tabs";
import { useSafeMode } from "../../rescue/safe-mode";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";

/** The Agent whose apps lead the list, on the server it lives on. */
export interface SidebarAppsAgent {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
}

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

/** The Agent's sidebar shortcuts, as its server lists them; null until the first answer. */
function useAgentApps(agent: SidebarAppsAgent | null) {
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

export function useSidebarApps(): {
  agent: SidebarAppsAgent | null;
  rows: readonly SidebarAppRow[];
  /** Reads the Agent's list again (after a write the server announces anyway). */
  reload: () => void;
} {
  const { currentProject, currentAgent, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const page = usePageAgent();
  const { locale } = useLocale();
  const agent = useMemo<SidebarAppsAgent | null>(() => {
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
