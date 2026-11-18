import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolModelSettings, ToolModelSettingsPatch } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { ApiError } from "../api/client";
import { getCapabilities, updateCapabilities } from "../api/project-capabilities";
import {
  serverPluginsChanged,
  projectCapabilitiesChanged,
  notifyProjectChange,
} from "../lib/project-change-events";
import { apiErrorText } from "../lib/api-error";
import { sameModelRef } from "../lib/model-grouping";

/** One project/host per snapshot. A model-table edit also refreshes its compatible candidates. */
export function useProjectCapabilities(
  projectId: string | null,
  server: string | null,
  catalogRevision?: unknown,
) {
  const key = JSON.stringify([server, projectId]);
  const [snapshot, setSnapshot] = useState<{ key: string; settings: ToolModelSettings } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const active = useRef(key);
  active.current = key;
  const writing = useRef<string | null>(null);
  const settings = snapshot?.key === key ? snapshot.settings : null;
  const readCurrent = useCallback(
    async (signal: AbortSignal) => {
      if (!projectId || active.current !== key) return null;
      try {
        const next = await getCapabilities(projectId, server, signal);
        if (signal.aborted || active.current !== key) return null;
        setFailure(null);
        setSnapshot({ key, settings: next });
        return next;
      } catch (reason) {
        if (!signal.aborted && active.current === key) {
          // A transient refresh failure must not discard unsaved instructions; a project we
          // no longer have access to must clear its previous response.
          if (reason instanceof ApiError && [401, 403, 404].includes(reason.status))
            setSnapshot(null);
          setFailure({ key, message: apiErrorText(reason) });
        }
        return null;
      }
    },
    [key, projectId, server],
  );
  const reload = useCallback(() => {
    if (!projectId || writing.current === key) return;
    request.current?.abort();
    const job = new AbortController();
    request.current = job;
    void readCurrent(job.signal);
  }, [key, projectId, readCurrent]);
  useEffect(() => {
    if (!projectId) return;
    reload();
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) reload();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === projectCapabilitiesChanged || event.key === serverPluginsChanged) reload();
    };
    const visible = () => {
      if (document.visibilityState === "visible") reload();
    };
    const pluginsChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === projectId) reload();
    };
    window.addEventListener(serverPluginsChanged, pluginsChanged);
    window.addEventListener(projectCapabilitiesChanged, changed);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      request.current?.abort();
      window.removeEventListener(serverPluginsChanged, pluginsChanged);
      window.removeEventListener(projectCapabilitiesChanged, changed);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, projectId, reload, catalogRevision]);
  async function save(patch: ToolModelSettingsPatch) {
    if (!projectId || !settings || writing.current !== null) return false;
    request.current?.abort();
    const check = new AbortController();
    request.current = check;
    writing.current = key;
    setPendingKey(key);
    try {
      // Another administrator can unload a provider or remove a model while its card is open.
      const live = await getCapabilities(projectId, server, check.signal);
      if (active.current !== key || check.signal.aborted) return false;
      for (const { key: slot } of settings.available ?? []) {
        const model = patch.bindings?.[slot];
        if (model === undefined) continue;
        if (
          !live.available?.some((entry) => entry.key === slot) ||
          (model === null
            ? !sameModelRef(live.bindings[slot], settings.bindings[slot])
            : !live.candidates[slot]?.some((row) => sameModelRef(row, model)))
        ) {
          setSnapshot({ key, settings: live });
          return false;
        }
      }
      const next = await updateCapabilities(projectId, patch, server);
      if (active.current === key) setSnapshot({ key, settings: next });
      notifyProjectChange(projectCapabilitiesChanged, key);
      return active.current === key;
    } catch (reason) {
      if (active.current === key && !check.signal.aborted) {
        setSnapshot({ key, settings });
        toastError(apiErrorText(reason));
      }
      return false;
    } finally {
      if (writing.current === key) {
        writing.current = null;
        setPendingKey(null);
        if (active.current === key) reload();
      }
    }
  }
  return {
    settings,
    error: failure?.key === key ? failure.message : "",
    busy: pendingKey !== null,
    reload,
    readCurrent,
    save,
  };
}
