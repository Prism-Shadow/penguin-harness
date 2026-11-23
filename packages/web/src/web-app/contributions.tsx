import { PagesContext, type WebAppPagesValue } from "../lib/web-app-pages";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import type { ContributionsResponse, RendererRef } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { FileRendererRulesContext, type FileRendererRule } from "../lib/file-renderers";

import { contributionShown, setRunningServerModules, useModuleGates } from "../lib/module-gate";
import { subscribeUserEvents } from "../lib/amsp/user-events";
import { runningModulesFor } from "./running-modules";
import { startMetricsOf } from "../lib/start-metrics";
import { useSafeMode } from "../rescue/safe-mode";
import { useAuth } from "../state/auth";
import { webAppDeps } from "./deps";
import { FramePage } from "./frame-page";
import { parentedPagesOf, removedPagesOf, windowFrameOf, type WebAppPage } from "./page-table";
import { windowRedirectFor } from "./window-redirect";

/** What the store holds for the current user. */
export interface ContributionsState {
  /** Whose state this is. */
  user: string | null;
  /** The server's answer; null until it has answered, and for good when it failed. */
  answer: ContributionsResponse | null;
  /** A signed-in user's request is in flight: a path that is not in the table yet may still arrive. */
  pending: boolean;
}

export interface ContributionsStore {
  /** The signed-in user (null = nobody): a change drops the last user's answer and asks again. */
  setUser(userId: string | null): void;
  /**
   * Asks again for the signed-in user (the server said its contributions changed, or the event
   * stream lost events) and answers the new response, or null when nobody is signed in or the
   * request failed — which keeps the answer held so far.
   */
  refresh(): Promise<ContributionsResponse | null>;
  current(): ContributionsState;
  subscribe(listener: () => void): () => void;
}

/**
 * How long to wait before asking again after a failed read, attempt by attempt; the last wait
 * repeats. A failure is retried: the answer decides which plugin web halves are drawn, so one
 * dropped request must not hide them for the life of the page.
 */
export const CONTRIBUTIONS_RETRY_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

export function createContributionsStore(
  fetch: () => Promise<ContributionsResponse>,
  retryMs: readonly number[] = CONTRIBUTIONS_RETRY_MS,
): ContributionsStore {
  let state: ContributionsState = { user: null, answer: null, pending: false };
  // Which request the newest user made: a late answer for the user just left is dropped, or
  // one user's pages would show to the next. A newer ask also stands in for a retry pending.
  let asked = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ContributionsState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  /** One read for `user`, retried after a failure until it lands or a newer ask replaces it. */
  const ask = (
    user: string,
    mine: number,
    attempt: number,
  ): Promise<ContributionsResponse | null> =>
    fetch().then(
      (answer) => {
        if (asked === mine) set({ user, answer, pending: false });
        return answer;
      },
      () => {
        if (asked !== mine) return null;
        // The answer held so far stands (nothing at all for a new user: the compiled table is a
        // complete app); the read is tried again a little later.
        if (state.pending) set({ ...state, pending: false });
        const wait = retryMs[Math.min(attempt, retryMs.length - 1)] ?? 30_000;
        retry = setTimeout(() => {
          retry = null;
          if (asked === mine) void ask(user, mine, attempt + 1);
        }, wait);
        return null;
      },
    );
  const begin = (): number => {
    if (retry !== null) clearTimeout(retry);
    retry = null;
    return ++asked;
  };
  return {
    setUser(next) {
      if (next === state.user) return;
      const mine = begin();
      set({ user: next, answer: null, pending: next !== null });
      if (next !== null) void ask(next, mine, 0);
    },
    refresh() {
      const user = state.user;
      if (user === null) return Promise.resolve(null);
      return ask(user, begin(), 0);
    },
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Paths the router owns outside the page table. */
const ROUTER_PATHS = ["/login"];

/** A contributed page: a component bound to its iframe renderer. */
function framePageFor(src: string, title: string) {
  return function ContributedFramePage() {
    return <FramePage src={src} title={title} />;
  };
}

/** The renderer an entry names, as this build reads it; null when it names none it could draw. */
function rendererOf(raw: unknown): RendererRef | null {
  const ref = raw as { iframe?: { src?: unknown; namespace?: unknown }; builtin?: unknown } | null;
  const iframe = ref?.iframe;
  if (typeof iframe?.src === "string") {
    const namespace = typeof iframe.namespace === "string" ? iframe.namespace : "";
    return { iframe: { src: iframe.src, namespace } };
  }
  if (typeof ref?.builtin === "string") return { builtin: ref.builtin };
  return null;
}

/**
 * The compiled pages plus the contributed ones this build can draw, appended in the server's
 * order after the last compiled page, each keeping the renderer it named. An entry is skipped
 * when it lacks a key or a path, when a compiled page (or an earlier entry) owns its key or
 * path, or when its renderer is neither an iframe with a `src` nor a `builtin` name in
 * `renderers`. Its nav name, glyph and parent are kept when they are strings, and its `app` when
 * it makes the page a system app (systemAppOf); whether its parent can hold it is decided over the
 * merged table (parentedPagesOf). An iframe page that is a system app opens in the App Center's
 * window (page-table.ts `windowFrameOf`), so what its route draws is the way into that window
 * (window-redirect.tsx), not its frame.
 *
 * A company-mode page (`nav: "org"`) has a path relative to an organization: company mode
 * mounts it under the organization layout (features/company/org-routes.tsx) and the router
 * beside WebApp's own pages, from the root, so its path is kept without a leading slash and
 * clashes as the rooted one. Any other page's path is absolute.
 */
export function contributedPagesOf(
  compiled: readonly WebAppPage[],
  answer: ContributionsResponse | null,
  renderers: ReadonlyMap<string, ComponentType>,
): readonly WebAppPage[] {
  if (answer === null || answer.pages.length === 0) return compiled;
  const keys = new Set(compiled.map((p) => p.key));
  const paths = new Set([...ROUTER_PATHS, ...compiled.map((p) => p.path)]);
  let order = compiled.reduce((last, p) => Math.max(last, p.order), 0);
  const out = [...compiled];
  for (const entry of answer.pages) {
    const { key, nav, admin, released, parent, title, titleZh, icon } = entry;
    if (typeof key !== "string" || key === "" || keys.has(key)) continue;
    if (typeof entry.path !== "string") continue;
    const org = nav === "org";
    const path = org ? entry.path.replace(/^\/+/, "") : entry.path;
    if (org ? path === "" : !path.startsWith("/")) continue;
    const rooted = org ? `/${path}` : path;
    if (paths.has(rooted)) continue;
    const renderer = rendererOf(entry.renderer);
    if (renderer === null) continue;
    const app = systemAppOf(entry.app, title, key);
    const offered = released !== false;
    const windowed =
      windowFrameOf({
        renderer,
        nav: org ? "org" : "none",
        released: offered,
        ...(app !== null ? { app } : {}),
      }) !== null;
    const Component = windowed
      ? windowRedirectFor(key, path)
      : "iframe" in renderer
        ? framePageFor(renderer.iframe.src, typeof title === "string" ? title : key)
        : renderers.get(renderer.builtin);
    if (Component === undefined) {
      console.warn(
        `Missing builtin renderer "${"builtin" in renderer ? renderer.builtin : ""}" for contributed page "${key}" (${path}); skipping page`,
      );
      continue;
    }
    keys.add(key);
    paths.add(rooted);
    out.push({
      id: entry.id,
      key,
      path,
      frame: "shell",
      nav: org ? "org" : nav === "main" ? "main" : "none",
      admin: admin === true,
      released: offered,
      order: ++order,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof titleZh === "string" ? { titleZh } : {}),
      ...(typeof icon === "string" ? { icon } : {}),
      ...(typeof parent === "string" ? { parent } : {}),
      ...(app !== null ? { app } : {}),
      renderer,
      Component,
    });
  }
  return out;
}

/**
 * A contributed page's `app` as the table keeps it: one whose `order` is a finite number makes the
 * page a system app (lib/system-apps.ts). A page naming no `title` has no name for its tile, so it
 * is no app: it stays reachable by its path, and the console says why its tile is missing.
 */
function systemAppOf(raw: unknown, title: unknown, key: string): { order: number } | null {
  const order = (raw as { order?: unknown } | null | undefined)?.order;
  if (typeof order !== "number" || !Number.isFinite(order)) return null;
  if (typeof title !== "string") {
    console.warn(`Contributed page "${key}" declares an app but no title; it is not an app`);
    return null;
  }
  return { order };
}

/**
 * The answer's file renderer rules this build can read, in the server's order: extensions are
 * strings, dropped of a leading dot and lowercased (empty ones dropped), and the renderer is a
 * `builtin` name. Anything else — no extensions left, an iframe renderer, a missing field, an
 * answer from a server that sends no such list — is skipped. Whether the name is in this build's
 * registry is the conversation's question, not this one's.
 */
export function fileRendererRulesOf(
  answer: ContributionsResponse | null,
): readonly FileRendererRule[] {
  const entries: unknown = answer?.fileRenderers;
  if (!Array.isArray(entries)) return NO_RULES;
  const rules: FileRendererRule[] = [];
  for (const entry of entries as Array<Record<string, unknown> | null>) {
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
    const builtin = (entry.renderer as { builtin?: unknown } | undefined)?.builtin;
    if (typeof builtin !== "string" || builtin === "" || !Array.isArray(entry.extensions)) continue;
    const extensions = (entry.extensions as unknown[])
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.replace(/^\./, "").toLowerCase())
      .filter((e) => e !== "");
    if (extensions.length > 0) rules.push({ id: entry.id, extensions, builtin });
  }
  return rules;
}

const NO_RULES: readonly FileRendererRule[] = [];

/**
 * The keys of the pages the answer removes, in the server's order: an entry is read when its key
 * is a non-empty string; anything else, and an answer that sends no such list, is skipped.
 */
export function pageRemovalsOf(answer: ContributionsResponse | null): readonly string[] {
  const entries: unknown = answer?.pageRemovals;
  if (!Array.isArray(entries)) return NO_REMOVALS;
  return (entries as Array<{ key?: unknown } | null>)
    .map((entry) => entry?.key)
    .filter((key): key is string => typeof key === "string" && key !== "");
}

const NO_REMOVALS: readonly string[] = [];

/**
 * The table the router and the nav read: the compiled pages with the contributed ones appended,
 * the removed ones dropped from both, and then every page whose parent is gone — so a removed
 * page takes the pages under it along.
 */
export function pageTableFor(
  compiled: readonly WebAppPage[],
  answer: ContributionsResponse | null,
  renderers: ReadonlyMap<string, ComponentType>,
): readonly WebAppPage[] {
  return parentedPagesOf(
    removedPagesOf(contributedPagesOf(compiled, answer, renderers), pageRemovalsOf(answer)),
  );
}

/** The answer's parts besides the pages, for the features that read them (web-app/index.ts). */

/**
 * Holds the signed-in user's contributions — the merged page table and the file renderer rules —
 * for everything under the router.
 */
export function WebAppPagesProvider({ children }: { children: ReactNode }) {
  const { pages: booted, pageRenderers } = webAppDeps.useDeps();
  // A page of a web module waiting for its server module is in the table only while that
  // module runs (gated-slots.ts); the table follows the gates.
  const gates = useModuleGates();
  const compiled = useMemo(
    () => booted.filter((p) => p.gatedBy === undefined || contributionShown(p.gatedBy)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `gates` is what says the gates moved
    [booted, gates],
  );
  const signedIn = useAuth().user?.userId ?? null;
  const userId = useSafeMode() ? null : signedIn;
  const [store] = useState(() => createContributionsStore(api.getContributions));
  useEffect(() => store.setUser(userId), [store, userId]);
  const state = useSyncExternalStore(store.subscribe, store.current, store.current);
  // Until the effect above has told the store about a new user, the state is the last user's:
  // none of it is shown, and the new user's request counts as already in flight.
  const current = state.user === userId;
  const answer = current ? state.answer : null;
  const pending = current ? state.pending : userId !== null;
  const value = useMemo<WebAppPagesValue>(
    () => ({
      pages: pageTableFor(compiled, answer, pageRenderers),
      pending,
      // A mocked or older server may leave these out.
      quickStarts: [],
      startMetrics: startMetricsOf(answer),
      refresh: store.refresh,
    }),
    [compiled, answer, pageRenderers, pending, store],
  );
  const rules = useMemo(() => fileRendererRulesOf(answer), [answer]);
  // The server re-assembled (a plugin came or went), or the stream lost events: ask again.
  useEffect(
    () =>
      subscribeUserEvents((ev) => {
        if (ev.type === "contributions_changed" || ev.type === "resync_required") {
          void store.refresh();
        }
      }),
    [store],
  );
  // The plugin server modules this generation runs open the gates of the web modules that need
  // them (lib/module-gate.ts); until the server first answers, the list this browser last saw
  // for this viewer stands in, so a plugin's web half does not pop in after every load.
  // Signed out or in safe mode, every gate is shut.
  useEffect(() => setRunningServerModules(runningModulesFor(userId, answer)), [userId, answer]);
  return (
    <PagesContext.Provider value={value}>
      <FileRendererRulesContext.Provider value={rules}>
        {children}
      </FileRendererRulesContext.Provider>
    </PagesContext.Provider>
  );
}

export { useContributions, useWebAppPages, useWebAppPagesPending } from "../lib/web-app-pages";
export type { ContributionsValue } from "../lib/web-app-pages";
