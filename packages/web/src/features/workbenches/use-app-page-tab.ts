/**
 * The one workbench page a whole-page view shows — the full-page route and the App Center's
 * window both render it: the tab `tabKey` names, else the workbench's first; `null` when there is
 * no such page, `undefined` until the first answer; `off` when the workbench is listed but does
 * not run (its own switch or the Agent-wide one is off), so it serves no page and the view says
 * why. `pages` are all of the workbench's pages, for a view that switches between them; `gone`
 * says the workbench itself is no more: the Agent answered without it, or the Agent is not found.
 * Only this workbench is read from the page's Agent (and only it is loaded, never the Agent's
 * other workbenches, which would hold the page back behind their compiles), and it is
 * read again whenever the server says a workbench of that Agent changed or went away. A read
 * that fails keeps the page already shown and reports why.
 *
 * `ownEvents` is for a view mounted outside the app shell: the shell's provider is what holds the
 * user event stream open and raises WORKBENCH_UPDATED_EVENT, so without it the view opens a
 * stream of its own, or it would never notice its workbench being edited or removed.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { openUserEvents } from "../../api/sse";
import {
  appPageTab,
  runningWorkbenches,
  WORKBENCH_UPDATED_EVENT,
  workbenchTabsOf,
  type WorkbenchTab,
  type WorkbenchUpdatedDetail,
} from "../../lib/workbench-tabs";
import { failureNode } from "../../lib/failure";

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
  /** Every page of the workbench that runs, in its order: none until the first answer. */
  pages: readonly WorkbenchTab[];
  /** The workbench as its Agent's list last answered it; null until then, or when it lacks it. */
  workbench: WorkbenchInfo | null;
  off: boolean;
  /** The workbench is no more (its Agent's list lacks it, or the Agent is not found). */
  gone: boolean;
  /** Why the list could not be read: its words, and 「[报告问题]」 for a failure. */
  failure: ReactNode;
} {
  const [tab, setTab] = useState<WorkbenchTab | null | undefined>(undefined);
  const [pages, setPages] = useState<readonly WorkbenchTab[]>([]);
  const [workbench, setWorkbench] = useState<WorkbenchInfo | null>(null);
  const [off, setOff] = useState(false);
  const [gone, setGone] = useState(false);
  const [failure, setFailure] = useState<ReactNode>(null);

  useEffect(() => {
    if (!enabled) {
      setTab(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getWorkbench(projectId, agentId, workbenchId, machineId);
        if (!alive) return;
        const running = runningWorkbenches(res);
        const listed = res.workbenches.find((w) => w.id === workbenchId) ?? null;
        setWorkbench(listed);
        setOff(listed !== null && !running.some((w) => w.id === workbenchId));
        setGone(listed === null);
        const tabs = workbenchTabsOf(running, machineId);
        setPages(tabs.filter((t) => t.workbenchId === workbenchId));
        setTab(appPageTab(tabs, workbenchId, tabKey));
        setFailure(null);
      } catch (err) {
        if (alive && err instanceof ApiError && err.status === 404) setGone(true);
        if (alive) {
          setFailure(
            failureNode(err, {
              text: err instanceof Error ? err.message : String(err),
              what: "an app's page could not be read",
            }),
          );
        }
      }
    };
    void load();
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (d.projectId === projectId && d.agentId === agentId && (d.machineId ?? null) === machineId)
        void load();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    const conn = ownEvents
      ? openUserEvents(
          {
            onRecord: () => undefined,
            onServerEvent: (ev) => {
              if (ev.type !== "workbench_updated" && ev.type !== "workbench_removed") return;
              if (ev.projectId === projectId && ev.agentId === agentId) void load();
            },
          },
          machineId,
        )
      : null;
    return () => {
      alive = false;
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
      conn?.close();
    };
  }, [enabled, ownEvents, projectId, agentId, workbenchId, tabKey, machineId]);

  return { tab, pages, workbench, off, gone, failure };
}
