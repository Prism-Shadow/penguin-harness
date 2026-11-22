/**
 * The review behind Clean up temporary files (Settings › Storage): what the server says can be
 * removed safely right now, what is chosen, and the removal itself.
 *
 * - A review is asked for an idle age (the days an idle scratchpad has had no activity); the
 *   server measures first, so it can take a while, and the review shown stays until the next
 *   one lands. Only the newest review asked for lands.
 * - What a review chooses to begin with is the server's (`selected` on each item). A review
 *   asked again keeps the choice on the items both reviews hold; a new item takes the server's.
 * - Removing sends the chosen items with the age they were reviewed at, at most 500 per request
 *   (the route's cap), and answers how many went, their size, and what was left and why.
 *
 * A vanilla store, so the dialog's behaviour runs in Node against the fetch fake.
 */
import { createStore } from "zustand/vanilla";
import type { StorageCleanupItem, StorageCleanupResult, StorageCleanupReview } from "../types";
import { apiErrorText } from "@prismshadow/penguin-web-plugin";
import * as api from "./api";

/** The idle age a review starts at, in days. */
export const CLEANUP_DEFAULT_DAYS = 7;

/** The idle ages the server accepts, in days. */
export const CLEANUP_MIN_DAYS = 1;
export const CLEANUP_MAX_DAYS = 3650;

/** Items one removal request may name (the route's own cap). */
const ITEMS_MAX = 500;

export interface CleanupState {
  /** The age the review on screen was asked for. */
  olderThanDays: number;
  /** The review on screen; null until the first one lands. */
  review: StorageCleanupReview | null;
  /** A review is on its way. */
  loading: boolean;
  /** Why the last review failed; null when it did not. */
  error: string | null;
  /** The chosen items, by id. */
  selected: ReadonlySet<string>;
  /** A removal is on its way. */
  busy: boolean;
}

export interface CleanupStoreState extends CleanupState {
  /** Asks for a review at an idle age. */
  load: (olderThanDays: number) => Promise<void>;
  setSelected: (next: ReadonlySet<string>) => void;
  /** Removes the chosen items; null when the server refused (the failure is reported). */
  remove: () => Promise<StorageCleanupResult | null>;
  /** Drops the answers still on their way (the dialog is closing). */
  dispose: () => void;
}

/** The chosen items of the review on screen. */
export function chosenItems(state: CleanupState): StorageCleanupItem[] {
  return (state.review?.items ?? []).filter((item) => state.selected.has(item.id));
}

/** Their size together, in bytes. */
export function chosenBytes(state: CleanupState): number {
  return chosenItems(state).reduce((n, item) => n + item.bytes, 0);
}

export function createCleanupStore(
  onError: (message: string, error: unknown) => void = () => undefined,
) {
  let gen = 0;
  return createStore<CleanupStoreState>((set, get) => ({
    olderThanDays: CLEANUP_DEFAULT_DAYS,
    review: null,
    loading: false,
    error: null,
    selected: new Set(),
    busy: false,

    load: async (olderThanDays) => {
      const g = ++gen;
      set({ loading: true, error: null });
      try {
        const review = await api.getStorageCleanup(olderThanDays);
        if (g !== gen) return;
        const before = new Map((get().review?.items ?? []).map((item) => [item.id, item]));
        const { selected } = get();
        const next = new Set(
          review.items
            .filter((item) => (before.has(item.id) ? selected.has(item.id) : item.selected))
            .map((item) => item.id),
        );
        set({ review, olderThanDays: review.olderThanDays, selected: next, loading: false });
      } catch (err) {
        if (g !== gen) return;
        set({ loading: false, error: apiErrorText(err) });
      }
    },

    setSelected: (next) => set({ selected: new Set(next) }),

    remove: async () => {
      const ids = chosenItems(get()).map((item) => item.id);
      if (ids.length === 0) return null;
      set({ busy: true });
      const total: StorageCleanupResult = { removed: 0, bytes: 0, skipped: [] };
      try {
        for (let i = 0; i < ids.length; i += ITEMS_MAX) {
          const part = await api.runStorageCleanup({
            items: ids.slice(i, i + ITEMS_MAX),
            olderThanDays: get().olderThanDays,
          });
          total.removed += part.removed;
          total.bytes += part.bytes;
          total.skipped.push(...part.skipped);
        }
        return total;
      } catch (err) {
        onError(apiErrorText(err), err);
        // What went before the refusal is gone all the same: say so rather than nothing.
        return total.removed > 0 || total.skipped.length > 0 ? total : null;
      } finally {
        set({ busy: false });
      }
    },

    dispose: () => {
      gen += 1;
    },
  }));
}

export type CleanupStore = ReturnType<typeof createCleanupStore>;
