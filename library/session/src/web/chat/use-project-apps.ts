/**
 * The apps the start page's app shortcuts (optimize, publish) offer: the Project's App Center
 * shortcuts on the machine that holds the draft's Workspace, the system Agent's apps left out.
 *
 * The list is read when the draft's Project or machine changes, and again a moment after the
 * server says a workbench there finished loading or went away; a burst of that news (a restart
 * loads every workbench of an Agent) is one read, as in the App Center. Only the newest read's
 * answer applies. An answer belongs to the Project and machine it was read for, so after the
 * draft moves to another machine the earlier machine's apps are not offered while the new one
 * answers.
 *
 * `apps` is null until the first answer, which the menu shows as loading, never as empty. A read
 * that fails keeps the apps already shown; a failure with nothing to show is `error`, with
 * 「[报告问题]」 when it was a failure rather than a refusal.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  api,
  failureNode,
  SYSTEM_AGENT_ID,
  useSafeMode,
  WORKBENCH_NEWS_SETTLE_MS,
  WORKBENCH_UPDATED_EVENT,
  type WorkbenchUpdatedDetail,
} from "@prismshadow/penguin-web/internal";

export interface ProjectApps {
  /** The non-system apps, in the App Center's order; null until the first answer arrives. */
  apps: AppCenterShortcut[] | null;
  /** Why the newest read failed, while there are no apps to show; null otherwise. */
  error: ReactNode;
  /** Reads the list again. */
  retry: () => void;
}

const NO_APPS: AppCenterShortcut[] = [];

export function useProjectApps(projectId: string | null, machineId: string | null): ProjectApps {
  // Safe mode runs nothing the server contributes, so it offers no app to change either; without
  // a Project there is none to offer.
  const safe = useSafeMode();
  /** Which Project on which machine an answer is about. */
  const where = projectId === null ? null : `${machineId ?? ""}\n${projectId}`;
  const [loaded, setLoaded] = useState<{ where: string; apps: AppCenterShortcut[] } | null>(null);
  const [failed, setFailed] = useState<{ where: string; error: ReactNode } | null>(null);
  /** Reads so far: an answer applies only while nothing newer was asked. */
  const asked = useRef(0);

  const read = useCallback(async () => {
    if (projectId === null || where === null) return;
    const ask = ++asked.current;
    setFailed(null);
    try {
      const { shortcuts } = await api.getAppCenter(projectId, machineId);
      if (ask !== asked.current) return;
      setLoaded({ where, apps: shortcuts.filter((app) => app.agentId !== SYSTEM_AGENT_ID) });
    } catch (err) {
      if (ask === asked.current) {
        const error = failureNode(err, { what: "the start page's app list could not be read" });
        setFailed({ where, error });
      }
    }
  }, [projectId, machineId, where]);

  useEffect(() => {
    if (safe) return;
    void read();
    return () => {
      asked.current++;
    };
  }, [read, safe]);

  useEffect(() => {
    if (safe || projectId === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const news = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (detail?.projectId !== projectId || (detail.machineId ?? null) !== machineId) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, WORKBENCH_NEWS_SETTLE_MS);
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, news);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, news);
    };
  }, [read, safe, projectId, machineId]);

  const retry = useCallback(() => void read(), [read]);
  if (safe || where === null) return { apps: NO_APPS, error: null, retry };
  const apps = loaded !== null && loaded.where === where ? loaded.apps : null;
  const error = apps === null && failed !== null && failed.where === where ? failed.error : null;
  return { apps, error, retry };
}
