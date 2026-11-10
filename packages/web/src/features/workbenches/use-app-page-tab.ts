/**
 * The one workbench page a whole-page view shows — the full-page route and the App Center's
 * window both render it: the tab `tabKey` names, else the workbench's first; `null` when there is
 * no such page, `undefined` until the first answer; `off` when the workbench is listed but does
 * not run (its own switch or the Agent-wide one is off), so it serves no page and the view says
 * why. The list is read from the page's Agent, and
 * read again whenever the server says a workbench of that Agent changed or went away. A read
 * that fails keeps the page already shown and reports why.
 *
 * `ownEvents` is for a view mounted outside the app shell: the shell's provider is what holds the
 * user event stream open and raises WORKBENCH_UPDATED_EVENT, so without it the view opens a
 * stream of its own, or it would never notice its workbench being edited or removed.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { openUserEvents } from "../../api/sse";
import {
  appPageTab,
  runningWorkbenches,
  WORKBENCH_UPDATED_EVENT,
  workbenchTabsOf,
  type WorkbenchTab,
  type WorkbenchUpdatedDetail,
} from "../../lib/workbench-tabs";

export interface AppPageTabQuery {
  projectId: string;
  agentId: string;
  workbenchId: string;
  tabKey?: string | undefined;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
  ownEvents: boolean;
  /** False reads nothing and shows no page (the app's safe mode). */
  enabled?: boolean;
}

export function useAppPageTab({
  projectId,
  agentId,
  workbenchId,
  tabKey,
  machineId,
  ownEvents,
  enabled = true,
}: AppPageTabQuery): {
  tab: WorkbenchTab | null | undefined;
  off: boolean;
  failure: string | null;
} {
  const [tab, setTab] = useState<WorkbenchTab | null | undefined>(undefined);
  const [off, setOff] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTab(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getWorkbenches(projectId, agentId, machineId);
        if (!alive) return;
        const running = runningWorkbenches(res);
        setOff(
          res.workbenches.some((w) => w.id === workbenchId) &&
            !running.some((w) => w.id === workbenchId),
        );
        setTab(appPageTab(workbenchTabsOf(running, machineId), workbenchId, tabKey));
        setFailure(null);
      } catch (err) {
        if (alive) setFailure(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (d.projectId === projectId && d.agentId === agentId) void load();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    const conn = ownEvents
      ? openUserEvents({
          onRecord: () => undefined,
          onServerEvent: (ev) => {
            if (ev.type !== "workbench_updated" && ev.type !== "workbench_removed") return;
            if (ev.projectId === projectId && ev.agentId === agentId) void load();
          },
        })
      : null;
    return () => {
      alive = false;
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
      conn?.close();
    };
  }, [enabled, ownEvents, projectId, agentId, workbenchId, tabKey, machineId]);

  return { tab, off, failure };
}
