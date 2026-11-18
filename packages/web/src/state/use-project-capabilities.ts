import { useCallback, useEffect, useRef, useState } from "react";
import type { CapabilitySettings, CapabilitySettingsPatch } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { capabilities, getCapabilities, updateCapabilities } from "../api/project-capabilities";
import { apiErrorText } from "../lib/api-error";

const changeEvent = "penguin-project-capabilities-changed";

function notifyChange(key: string) {
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: key }));
  try {
    window.localStorage.setItem(changeEvent, JSON.stringify({ key, at: crypto.randomUUID() }));
  } catch {
    // A browser that disables storage still updates the views in this window.
  }
}

function applyPatch(
  previous: CapabilitySettings,
  patch: CapabilitySettingsPatch,
): CapabilitySettings {
  const bindings = { ...previous.bindings };
  for (const key of capabilities) {
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
  const reload = useCallback(() => {
    if (!projectId || writing.current === key) return;
    request.current?.abort();
    const job = new AbortController();
    request.current = job;
    setFailure(null);
    void getCapabilities(projectId, server, job.signal)
      .then((next) => {
        if (!job.signal.aborted && active.current === key) setSnapshot({ key, settings: next });
      })
      .catch((reason) => {
        if (!job.signal.aborted && active.current === key)
          setFailure({ key, message: apiErrorText(reason) });
      });
  }, [key, projectId, server]);
  useEffect(() => {
    if (!projectId) return;
    reload();
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) reload();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === changeEvent) reload();
    };
    const visible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener(changeEvent, changed);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      request.current?.abort();
      window.removeEventListener(changeEvent, changed);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, projectId, reload, catalogRevision]);
  async function save(patch: CapabilitySettingsPatch) {
    if (!projectId || !settings || writing.current !== null) return;
    request.current?.abort();
    writing.current = key;
    setPendingKey(key);
    setSnapshot({ key, settings: applyPatch(settings, patch) });
    try {
      const next = await updateCapabilities(projectId, patch, server);
      if (active.current === key) setSnapshot({ key, settings: next });
      notifyChange(key);
    } catch (reason) {
      if (active.current === key) {
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
    save,
  };
}
