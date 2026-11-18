import { useCallback, useEffect, useRef, useState } from "react";
import type { CapabilitySettings, CapabilitySettingsPatch } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { getCapabilities, updateCapabilities } from "../api/project-capabilities";
import {
  serverPluginsChanged,
  projectCapabilitiesChanged,
  notifyProjectChange,
} from "../lib/project-change-events";
import { apiErrorText } from "../lib/api-error";
import { sameModelRef } from "../lib/model-grouping";

function applyPatch(
  previous: CapabilitySettings,
  patch: CapabilitySettingsPatch,
): CapabilitySettings {
  const bindings = { ...previous.bindings };
  for (const { key } of previous.available ?? []) {
    const value = patch.bindings?.[key];
    if (value === null) delete bindings[key];
    else if (value) bindings[key] = value;
  }
  return { ...previous, bindings, voicePolish: { ...previous.voicePolish, ...patch.voicePolish } };
}

/** One project/host per snapshot. A model-table edit also refreshes its compatible candidates. */
export function useProjectCapabilities(
  projectId: string | null,
  server: string | null,
  catalogRevision?: unknown,
) {
  const key = JSON.stringify([server, projectId]);
  const [snapshot, setSnapshot] = useState<{ key: string; settings: CapabilitySettings } | null>(
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
  async function save(patch: CapabilitySettingsPatch) {
    if (!projectId || !settings || writing.current !== null) return;
    request.current?.abort();
    const check = new AbortController();
    request.current = check;
    writing.current = key;
    setPendingKey(key);
    setSnapshot({ key, settings: applyPatch(settings, patch) });
    try {
      // Another administrator can unload a provider or remove a model while its card is open.
      const live = await getCapabilities(projectId, server, check.signal);
      if (active.current !== key || check.signal.aborted) return;
      for (const { key: slot } of settings.available ?? []) {
        const model = patch.bindings?.[slot];
        if (model === undefined) continue;
        if (
          !live.available?.some((entry) => entry.key === slot) ||
          (model !== null && !live.candidates[slot]?.some((row) => sameModelRef(row, model)))
        ) {
          setSnapshot({ key, settings: live });
          return;
        }
      }
      const next = await updateCapabilities(projectId, patch, server);
      if (active.current === key) setSnapshot({ key, settings: next });
      notifyProjectChange(projectCapabilitiesChanged, key);
    } catch (reason) {
      if (active.current === key && !check.signal.aborted) {
        setSnapshot({ key, settings });
        toastError(apiErrorText(reason));
      }
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
