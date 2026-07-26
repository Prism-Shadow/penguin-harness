/**
 * Lazily fetched version identity + update check for the sidebar user menu.
 *
 * Neither request fires on app load: both start on the first activation (the first time
 * the user opens the bottom dropdown) and the results are cached at module level for the
 * rest of the browser session — a locale switch remounts the whole tree, and component
 * state would refetch on every remount. Failures resolve to null and clear the shared
 * promise so a later dropdown open retries; nothing is surfaced as an error (the footer
 * simply shows nothing, and "no update known" hides the reminder).
 */
import { useEffect, useState } from "react";
import type { UpdateCheckResponse, VersionResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";

let versionCache: VersionResponse | null = null;
let versionPromise: Promise<VersionResponse> | null = null;
let updateCache: UpdateCheckResponse | null = null;
let updatePromise: Promise<UpdateCheckResponse> | null = null;

export interface VersionInfo {
  version: VersionResponse | null;
  update: UpdateCheckResponse | null;
}

export function useVersionInfo(active: boolean): VersionInfo {
  // Initial state comes from the module cache, so a remounted sidebar (locale switch)
  // shows the version footer and the update dot immediately, without reopening anything.
  const [version, setVersion] = useState<VersionResponse | null>(versionCache);
  const [update, setUpdate] = useState<UpdateCheckResponse | null>(updateCache);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    versionPromise ??= api.getVersion().then((res) => {
      versionCache = res;
      return res;
    });
    versionPromise
      .then((res) => {
        if (!cancelled) setVersion(res);
      })
      .catch(() => {
        versionPromise = null;
      });

    updatePromise ??= api.checkUpdate().then((res) => {
      updateCache = res;
      return res;
    });
    updatePromise
      .then((res) => {
        if (!cancelled) setUpdate(res);
      })
      .catch(() => {
        updatePromise = null;
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  return { version, update };
}
