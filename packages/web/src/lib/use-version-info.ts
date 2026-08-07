/**
 * Lazily fetched version identity + update check for the sidebar user menu.
 *
 * Neither request fires on app load: both start on the first activation (the first time
 * the user opens the bottom dropdown) and the results are cached at module level for the
 * rest of the browser session — a locale switch remounts the whole tree, and component
 * state would refetch on every remount. Failures resolve to null and clear the shared
 * promise so a later dropdown open retries; nothing is surfaced as an error (the footer
 * simply shows nothing, and "no update known" hides the reminder). forceUpdateCheck is
 * the one deliberate exception to the laziness: the user asked, so it refetches now and
 * broadcasts the result to every mounted hook.
 */
import { useEffect, useState } from "react";
import type { UpdateCheckResponse, VersionResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";

let versionCache: VersionResponse | null = null;
let versionPromise: Promise<VersionResponse> | null = null;
let updateCache: UpdateCheckResponse | null = null;
let updatePromise: Promise<UpdateCheckResponse> | null = null;

/**
 * Mounted hooks subscribe here so any refresh of the module cache reaches every
 * consumer at once — the footer, the update dots, the reminder rows, and the draft
 * page's version line all react without a remount. Two paths push: forceUpdateCheck
 * (the sidebar's manual "check for updates" action) and the lazy fetch resolving.
 * Active hooks await the shared promise themselves, but passive ones (active=false,
 * e.g. the collapsed rail's avatar dot) only ever read the cache — without the lazy
 * push they would miss a result that lands while they are mounted.
 */
const listeners = new Set<() => void>();

/** Pushes the current module cache to every mounted hook (see the listeners comment). */
function notifyAll(): void {
  for (const notify of listeners) notify();
}

/** How one manual update check ended, for user feedback — exactly one notice per outcome. */
export type UpdateCheckOutcome =
  | { kind: "disabled" }
  | { kind: "failed" }
  | { kind: "up-to-date" }
  | { kind: "found"; latestVersion: string };

/**
 * Classifies a manual check result. Order matters: `disabled` means no lookup ran, `error`
 * means the lookup ran and failed (the response is fail-soft, not an exception), and only a
 * result that names the newer release counts as `found` — updateAvailable without a version
 * would leave the row and the toast with nothing to show.
 */
export function updateCheckOutcome(res: UpdateCheckResponse): UpdateCheckOutcome {
  if (res.disabled === true) return { kind: "disabled" };
  if (res.error !== undefined) return { kind: "failed" };
  if (res.updateAvailable && res.latestVersion !== null) {
    return { kind: "found", latestVersion: res.latestVersion };
  }
  return { kind: "up-to-date" };
}

export interface VersionInfo {
  version: VersionResponse | null;
  update: UpdateCheckResponse | null;
}

export function useVersionInfo(active: boolean): VersionInfo {
  // Initial state comes from the module cache, so a remounted sidebar (locale switch)
  // shows the version footer and the update dot immediately, without reopening anything.
  const [version, setVersion] = useState<VersionResponse | null>(versionCache);
  const [update, setUpdate] = useState<UpdateCheckResponse | null>(updateCache);

  // Re-sync from the module cache whenever forceUpdateCheck pushes a fresh result.
  useEffect(() => {
    const sync = () => {
      setVersion(versionCache);
      setUpdate(updateCache);
    };
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    versionPromise ??= api.getVersion().then((res) => {
      versionCache = res;
      notifyAll();
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
      notifyAll();
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

/**
 * Forced re-check for the sidebar's manual "check for updates" action: asks the server
 * to bypass its TTL cache (?force=1), replaces the module cache, and pushes the result
 * to every mounted consumer. The shared promise is swapped in up front so consumers
 * activating mid-flight await the fresh lookup instead of resurrecting a stale one.
 * The update check itself stays fail-soft (a lookup failure resolves normally with
 * `error` set); this rejects only when the request to our own server fails — then the
 * shared promise is cleared so the passive path can retry, and the caller toasts.
 */
export async function forceUpdateCheck(): Promise<UpdateCheckResponse> {
  const promise = api.checkUpdate(true).then((res) => {
    updateCache = res;
    return res;
  });
  updatePromise = promise;
  try {
    return await promise;
  } catch (e) {
    if (updatePromise === promise) updatePromise = null;
    throw e;
  } finally {
    notifyAll();
  }
}
