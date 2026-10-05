/**
 * A tab that outlived a web push: reload it the first time one of its lazy chunks is gone.
 *
 * Every `assets/*` name is content-hashed, and a hot push replaces the whole web dist, so a tab
 * opened before a push keeps asking for the names ITS build knew. The ones it already loaded
 * live in its module map and keep working; the ones it had not loaded yet are no longer in the
 * dist, and the server answers them with the SPA fallback (index.html, as text/html — that
 * fallback lives in the runtime's static tail, which a push cannot change). The import fails
 * with "Failed to fetch dynamically imported module", and whatever sat behind it never
 * appears. On 2026-10-05 that was every Claude Code terminal on 53531: xterm is lazy
 * (terminal-view.tsx), and the push from d531v20 to d531v21 renamed its chunks.
 *
 * Vite's preload helper raises `vite:preloadError` on window for every failed dynamic import
 * it wraps (all of them in a build). The remedy is the one Vite documents: reload, which loads
 * the current index.html and with it the current chunk names.
 *
 * Once per build, not once per failure: the entry chunk's own URL names the build this tab
 * runs (it is hashed like every other asset), and it is remembered across the reload in
 * sessionStorage. A failure in a tab that already reloaded for this very build is not a stale
 * build — the network, or a chunk genuinely missing from the current dist — and reloading
 * again would loop, so the error is left to the caller to show.
 */

export const STALE_BUILD_RELOAD_KEY = "penguin.staleBuildReload";

export interface StaleBuildDeps {
  /** The entry chunk's URL: changes with every build. */
  build: string;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
}

/** Decides on one failed chunk load: true when it reloads, false when this build already did once. */
export function reloadForStaleBuild(deps: StaleBuildDeps): boolean {
  let last: string | null = null;
  try {
    last = deps.storage?.getItem(STALE_BUILD_RELOAD_KEY) ?? null;
  } catch {
    // Blocked site data: without a memory of the last reload there is no loop guard, so do
    // not reload at all — the failure surfaces as an error instead.
    return false;
  }
  if (last === deps.build || deps.storage === null) return false;
  try {
    deps.storage.setItem(STALE_BUILD_RELOAD_KEY, deps.build);
  } catch {
    return false;
  }
  deps.reload();
  return true;
}

/** Installs the listener for the life of the page. A no-op where there is no window (tests). */
export function watchStaleBuild(build: string): void {
  if (typeof window === "undefined") return;
  // The event is NOT default-prevented: that would resolve the import to undefined, and the
  // caller would fail on that instead of on the real error while the page unloads.
  window.addEventListener("vite:preloadError", () => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    reloadForStaleBuild({ build, storage, reload: () => location.reload() });
  });
}
