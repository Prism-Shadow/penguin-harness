/**
 * The Storage page's usage (Settings › Storage): what the data root holds, as the server last
 * measured it, and whether a measurement is under way.
 *
 * - The page reads the usage when it opens, and again after a cleanup (the server measures what
 *   the cleanup touched); Refresh asks the server to measure again.
 * - While a measurement is under way, a bounded read waits for the shared result.
 *   The numbers on screen stay until
 *   a new answer replaces them. A failed read keeps them too and asks again after a longer pause.
 * - Only the newest request's answer lands: a read that a Refresh overtook is dropped, and its
 *   poll with it. Closing the page stops the polling.
 *
 * A vanilla store with its async actions, so its behaviour runs in Node against the fetch fake.
 */
import { createStore } from "zustand/vanilla";
import type { StorageRevealRequest, StorageUsage } from "../types";
import { apiErrorText } from "@prismshadow/penguin-web-plugin";
import * as api from "./api";

/** How often the page asks again while a measurement is under way. */
export const STORAGE_POLL_MS = 1500;

/** How long the page waits before asking again after a failed read while measuring. */
export const STORAGE_POLL_RETRY_MS = 6000;

export interface StorageState {
  /** The last answer; null until the first one. */
  usage: StorageUsage | null;
  /** Why the first read failed; null once one answered. */
  loadError: string | null;
  /** A Refresh is on its way: its button waits. */
  refreshing: boolean;
}

export interface StorageStoreState extends StorageState {
  /** Reads the usage (the page opening, after a cleanup). */
  load: () => Promise<void>;
  /** Asks the server to measure again. */
  refresh: () => Promise<void>;
  /** Shows a Project's folder, or the data root, in the desktop's file manager. */
  reveal: (body: StorageRevealRequest) => Promise<void>;
  /** Stops the polling (the page is closing). */
  dispose: () => void;
}

export function createStorageStore(
  onError: (message: string, error: unknown) => void = () => undefined,
) {
  /** Invalidates the answers of requests a newer one replaced. */
  let gen = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stopPolling = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return createStore<StorageStoreState>((set, get) => {
    const schedule = (ms: number) => {
      stopPolling();
      timer = setTimeout(() => {
        timer = null;
        void ask(() => api.getStorageUsage(true), true);
      }, ms);
    };

    /**
     * Sends one request and lands its answer if nothing newer was sent meanwhile, then polls while
     * the answer says a measurement is under way. A poll's failure is quiet and asks again later;
     * a failure the reader asked for (a Refresh) is reported.
     */
    const ask = async (request: () => Promise<StorageUsage>, polling: boolean) => {
      const g = ++gen;
      const started = Date.now();
      stopPolling();
      if (!polling) set({ loadError: null });
      try {
        const usage = await request();
        if (g !== gen) return;
        set({ usage, loadError: null });
        // First wait immediately. Space repeated reads if a server answers before the wait expires.
        if (usage.measuring)
          schedule(polling ? Math.max(0, STORAGE_POLL_MS - (Date.now() - started)) : 0);
      } catch (err) {
        if (g !== gen) return;
        if (get().usage?.measuredAt == null) set({ loadError: apiErrorText(err) });
        else if (!polling) onError(apiErrorText(err), err);
        if (get().usage?.measuring === true) schedule(STORAGE_POLL_RETRY_MS);
      }
    };

    return {
      usage: null,
      loadError: null,
      refreshing: false,

      load: () => ask(() => api.getStorageUsage(), false),

      refresh: async () => {
        set({ refreshing: true });
        try {
          await ask(() => api.refreshStorageUsage(), false);
        } finally {
          set({ refreshing: false });
        }
      },

      reveal: async (body) => {
        try {
          await api.revealStorageFolder(body);
        } catch (err) {
          onError(apiErrorText(err), err);
        }
      },

      // Not final: a page mounted again (React's development double mount) reads again.
      dispose: () => {
        gen += 1;
        stopPolling();
      },
    };
  });
}

export type StorageStore = ReturnType<typeof createStorageStore>;
