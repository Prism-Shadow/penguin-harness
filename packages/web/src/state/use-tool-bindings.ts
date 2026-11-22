/**
 * A Project's tool-model bindings (`GET|PATCH …/models/tool-bindings`): which bindings the
 * enabled plugins declare, the model each is bound to and the configured models each accepts.
 *
 * Read again when the server says they changed (`tool_bindings_changed`, from any tab or
 * machine), when a plugin is turned on or off in this window, when the window is shown again, and
 * whenever `refreshKey` changes (the models page passes its table: an edit there changes the
 * candidates). One snapshot per server and Project, so a switch never shows the previous one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { getToolBindings, patchToolBinding } from "../api/endpoints";
import { ApiError } from "../api/client";
import { MULTIMODAL_TOOLS_PACKAGE, type ToolBinding } from "../api/tool-types";
import { apiErrorText } from "../lib/api-error";
import { subscribeUserEvents } from "../lib/amsp/user-events";
import { onPluginsChanged } from "../lib/project-change-events";

/**
 * The model the multimodal tools plugin's binding `key` runs on: undefined when the plugin is
 * off in the Project (its bindings are not listed) or nothing is bound.
 */
export function boundToolModel(
  bindings: readonly ToolBinding[] | null | undefined,
  key: string,
): ModelRefDto | undefined {
  return bindings?.find((b) => b.key === key && b.package === MULTIMODAL_TOOLS_PACKAGE)?.model;
}

export function useToolBindings(
  projectId: string | null,
  server: string | null,
  { refreshKey }: { refreshKey?: unknown } = {},
) {
  const key = JSON.stringify([server, projectId]);
  const [snapshot, setSnapshot] = useState<{ key: string; bindings: ToolBinding[] } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const active = useRef(key);
  active.current = key;

  const readCurrent = useCallback(
    async (signal: AbortSignal): Promise<ToolBinding[] | null> => {
      if (!projectId || active.current !== key) return null;
      try {
        const { bindings } = await getToolBindings(projectId, server, signal);
        if (signal.aborted || active.current !== key) return null;
        setFailure(null);
        setSnapshot({ key, bindings });
        return bindings;
      } catch (reason) {
        if (!signal.aborted && active.current === key) {
          // A Project this account can no longer see drops what it showed; a passing network
          // failure keeps it on screen with the error beside it.
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
    if (!projectId) return;
    request.current?.abort();
    const job = new AbortController();
    request.current = job;
    void readCurrent(job.signal);
  }, [projectId, readCurrent]);

  useEffect(() => {
    if (!projectId) return;
    reload();
    const unsubscribe = subscribeUserEvents((ev) => {
      const event = ev.type === "machine_event" ? ev.event : ev;
      if (event.type === "tool_bindings_changed" && event.projectId === projectId) reload();
    });
    const stopPlugins = onPluginsChanged((changed) => {
      if (changed === projectId) reload();
    });
    const shown = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("focus", shown);
    return () => {
      request.current?.abort();
      unsubscribe();
      stopPlugins();
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("focus", shown);
    };
  }, [projectId, reload, refreshKey]);

  /** Binds `binding` to `model`, or unbinds it with null (owner, this server). */
  const bind = useCallback(
    async (binding: string, model: ModelRefDto | null): Promise<boolean> => {
      if (!projectId || server !== null || writing !== null) return false;
      const at = key;
      setWriting(at);
      try {
        const { bindings } = await patchToolBinding(projectId, { key: binding, model });
        if (active.current === at) setSnapshot({ key: at, bindings });
        return active.current === at;
      } catch (reason) {
        if (active.current === at) {
          toastError(apiErrorText(reason));
          reload();
        }
        return false;
      } finally {
        setWriting(null);
      }
    },
    [key, projectId, server, writing, reload],
  );

  return {
    bindings: snapshot?.key === key ? snapshot.bindings : null,
    error: failure?.key === key ? failure.message : "",
    busy: writing !== null,
    reload,
    readCurrent,
    bind,
  };
}
