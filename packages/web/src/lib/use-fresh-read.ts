/**
 * A server read that stays current while the page is open, for lists that change underneath it:
 * the plugin library when an admin installs or removes a plugin, a Project's Benchmarks when one
 * is imported or deleted. Every mount reads again, so coming back to a page shows the change
 * without a reload. Until that read lands, the mount shows what the last one read under the same
 * key in this page load — a count does not drop back to "—", nor a list to empty, while the fresh
 * answer is on its way. A failed read keeps an earlier answer on screen: one failed refresh says
 * nothing about what it showed. It reports failure only when there is no answer at all.
 */
import { useEffect, useState } from "react";

export interface FreshRead<T> {
  /** The latest answer; null until the first one arrives. */
  value: T | null;
  /** The read failed with no earlier answer to show. */
  failed: boolean;
}

/**
 * `read()`'s answer under `key`, read again on every mount and on every change of `key`, starting
 * from the last answer `cache` holds for it. `cache` is the caller's, one per kind of read, and
 * lives as long as the page.
 */
export function useFreshRead<T>(
  cache: Map<string, T>,
  key: string,
  read: () => Promise<T>,
): FreshRead<T> {
  const [state, setState] = useState<FreshRead<T> & { key: string }>(() => ({
    key,
    value: cache.get(key) ?? null,
    failed: false,
  }));
  useEffect(() => {
    let cancelled = false;
    read().then(
      (value) => {
        cache.set(key, value);
        if (!cancelled) setState({ key, value, failed: false });
      },
      () => {
        if (cancelled) return;
        setState((prev) =>
          prev.key === key && prev.value !== null ? prev : { key, value: null, failed: true },
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // `read` is a fresh closure on every render; what it reads is named by `key`.
  }, [key]);
  // A key change without a remount shows that key's cached answer until its read lands.
  if (state.key !== key) return { value: cache.get(key) ?? null, failed: false };
  return { value: state.value, failed: state.failed };
}
