/**
 * The App Center's data: the Project's shortcuts as the server lists them, each with its build
 * state, and the viewer's own arrangement of them.
 *
 * The list is read when the page opens and whenever the Project's Agent list changes, and again
 * when the server says a workbench of the Project starts loading (`workbench_building`, so a tile
 * turns to building on its own) or finished loading or went away (`workbench_updated` /
 * `workbench_removed`, so it turns live on its own). Those news can come in a burst — a restart
 * loads every workbench of an Agent — so they ask for one read a moment later rather than one
 * each. Only the newest read's answer is applied, and a read that fails keeps what is shown.
 *
 * An arrangement the viewer makes is shown at once and then written; a write that fails is said
 * in a toast and the list is read back, so the grid returns to what is stored.
 *
 * For an administrator the Project's machines list their apps too: each machine's own App Center
 * read through this server's proxy (lib/machine-catalogs.ts), its tiles added after this server's
 * as it answers, labelled with the machine and keyed `<machineId>:<agentId>/<workbenchId>`. A
 * machine out of reach keeps the tiles it last answered (kept for the tab, without their icons),
 * shown but not opened; a workbench's news from a machine reads that machine again. The
 * arrangement is this server's, one for every machine: a move made before a machine answered
 * keeps that machine's tiles where they were (arrangement.ts, `keepUnseenApps`).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppCenterLayout, AppCenterShortcut } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { appAwaited, type LocatedShortcut } from "./arrangement";
import { createCatalogStore } from "../../lib/catalog-storage";
import { createReadStore } from "../../lib/read-store";
import { useMachineCatalogs } from "../../lib/machine-catalogs";
import { useMachines } from "../../state/machines";
import { toastApiError } from "../../lib/toast-api-error";
import {
  workbenchAppPath,
  WORKBENCH_BUILDING_EVENT,
  WORKBENCH_UPDATED_EVENT,
  type WorkbenchUpdatedDetail,
} from "../../lib/workbench-tabs";
import { failureNode } from "../../lib/failure";

/** How long a burst of workbench news is gathered into one read (ms). */
const NEWS_SETTLE_MS = 120;

/** Each machine's shortcuts, kept for the tab: display data only, no icon and no path. */
const remoteApps = createCatalogStore<AppCenterShortcut[]>(
  "apps.v1",
  (shortcuts) =>
    shortcuts.map(({ agentId, agentName, workbenchId, title, titleZh, tab, build }) => ({
      agentId,
      agentName,
      workbenchId,
      title,
      titleZh,
      tab,
      build,
      path: "",
    })),
  Array.isArray,
);

const loadRemoteApps = (projectId: string, machineId: string) =>
  api.getAppCenter(projectId, machineId).then((r) => r.shortcuts);

const loadRemoteHidden = (projectId: string, machineId: string) =>
  api.getAppCenter(projectId, machineId, true).then((r) => r.shortcuts);

export interface AppCenterData {
  /**
   * This server's shortcuts in its order, then each machine's; null until this server first
   * answers for this Project (or, when it fails, until a machine does).
   */
  shortcuts: LocatedShortcut[] | null;
  /** The names of the machines whose tiles are not live: out of reach, or their read failed. */
  unavailableMachines: string[];
  /** Reads again every connected machine whose read failed; null when none did. */
  retryFailures: (() => void) | null;
  /** Whether a stored app is one the grid cannot show yet (arrangement.ts, `appAwaited`). */
  awaitedApp: (key: string) => boolean;
  /** Reads one machine's apps again, or this server's without a machine. */
  refreshMachine: (machineId?: string) => void;
  /** The viewer's arrangement; null for the server's order. */
  layout: AppCenterLayout | null;
  /** Why the newest read failed, with 「[报告问题]」 for a failure; null once one succeeds. */
  error: ReactNode;
  reload: () => void;
  /** Shows and stores an arrangement; null restores the server's order. */
  saveLayout: (layout: AppCenterLayout | null) => void;
}

export function useAppCenter(
  projectId: string | null,
  agentIds: string,
  hidden = false,
): AppCenterData {
  /** The newest answer, with the Project it is about: another Project's tiles are never shown. */
  const [loaded, setLoaded] = useState<{
    projectId: string;
    shortcuts: AppCenterShortcut[];
    layout: AppCenterLayout | null;
  } | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  /** Reads and writes so far: a read's answer applies only while nothing newer was asked. */
  const asked = useRef(0);

  const load = useCallback(async () => {
    if (projectId === null) return;
    const ask = ++asked.current;
    try {
      const { shortcuts, layout } = await api.getAppCenter(projectId, null, hidden);
      if (ask !== asked.current) return;
      setLoaded({ projectId, shortcuts, layout });
      setError(null);
    } catch (err) {
      if (ask === asked.current) {
        setError(failureNode(err, { what: "the App Center could not be read" }));
      }
    }
  }, [projectId, hidden]);

  // An Agent added or removed adds or removes its tiles.
  useEffect(() => {
    void load();
  }, [load, agentIds]);

  // The restore dialog reads hidden apps afresh. Its results never enter the tile cache.
  const [hiddenApps] = useState(() => (hidden ? createReadStore<AppCenterShortcut[]>() : null));
  const remotes = useMachineCatalogs(
    hiddenApps ?? remoteApps,
    projectId,
    hidden ? loadRemoteHidden : loadRemoteApps,
  );
  const { state: machineList, settled: machinesSettled } = useMachines();
  const catalogs = useRef(remotes);
  catalogs.current = remotes;
  useEffect(() => {
    const machines = new Set<string | null>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const news = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (detail.projectId !== projectId) return;
      machines.add(detail.machineId ?? null);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        for (const id of machines) {
          if (id === null) void load();
          else catalogs.current.find((r) => r.machine.machineId === id)?.refresh();
        }
        machines.clear();
      }, NEWS_SETTLE_MS);
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, news);
    window.addEventListener(WORKBENCH_BUILDING_EVENT, news);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, news);
      window.removeEventListener(WORKBENCH_BUILDING_EVENT, news);
    };
  }, [load, projectId]);

  const current = loaded !== null && loaded.projectId === projectId ? loaded : null;

  const located = remotes.flatMap(({ machine, live, value }) =>
    (value ?? []).map((shortcut) => ({
      ...shortcut,
      machineId: machine.machineId,
      machineLabel: machine.label,
      unavailable: !live,
      path: workbenchAppPath(
        projectId!,
        shortcut.agentId,
        shortcut.workbenchId,
        shortcut.tab,
        machine.machineId,
      ),
    })),
  );
  const saveLayout = useCallback(
    (layout: AppCenterLayout | null) => {
      if (!current || projectId === null) return;
      // A read already under way answers with the arrangement from before this one.
      ++asked.current;
      setLoaded((prev) =>
        prev !== null && prev.projectId === projectId ? { ...prev, layout } : prev,
      );
      void api.putAppCenterLayout(projectId, layout).catch((err: unknown) => {
        toastApiError(err);
        void load();
      });
    },
    [projectId, load, current],
  );

  return {
    shortcuts: current
      ? [...current.shortcuts, ...located]
      : error && located.length
        ? located
        : null,
    retryFailures: remotes.some((r) => r.error && r.machine.link === "connected")
      ? () =>
          remotes
            .filter((r) => r.error && r.machine.link === "connected")
            .forEach((r) => r.refresh())
      : null,
    unavailableMachines: remotes
      .filter((r) => r.machine.link !== "connected" || r.error)
      .map((r) => r.machine.label),
    awaitedApp: (key) =>
      appAwaited(
        key,
        machinesSettled && machineList !== null
          ? remotes.map((r) => ({ machineId: r.machine.machineId, answered: r.value !== null }))
          : null,
      ),
    refreshMachine: (machineId) =>
      machineId ? remotes.find((r) => r.machine.machineId === machineId)?.refresh() : void load(),
    layout: current?.layout ?? null,
    error,
    reload: () => void load(),
    saveLayout,
  };
}
