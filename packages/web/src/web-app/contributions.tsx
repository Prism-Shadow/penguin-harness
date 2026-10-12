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
import { useSafeMode } from "../rescue/safe-mode";
import { useAuth } from "../state/auth";
import { webAppDeps } from "./deps";
import { FramePage } from "./frame-page";
import type { WebAppPage } from "./page-table";

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
   * Asks again for the signed-in user (after a plugin is installed or removed) and answers the
   * new response, or null when nobody is signed in or the request failed — which keeps the
   * answer held so far.
   */
  refresh(): Promise<ContributionsResponse | null>;
  current(): ContributionsState;
  subscribe(listener: () => void): () => void;
}

export function createContributionsStore(
  fetch: () => Promise<ContributionsResponse>,
): ContributionsStore {
  let state: ContributionsState = { user: null, answer: null, pending: false };
  // Which request the newest user made: a late answer for the user just left is dropped, or
  // one user's pages would show to the next.
  let asked = 0;
  const listeners = new Set<() => void>();
  const set = (next: ContributionsState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    setUser(next) {
      if (next === state.user) return;
      const mine = ++asked;
      set({ user: next, answer: null, pending: next !== null });
      if (next === null) return;
      fetch().then(
        (answer) => {
          if (asked === mine) set({ user: next, answer, pending: false });
        },
        () => {
          // Nothing to fold in: the compiled table is a complete app. No retry — the next
          // sign-in asks again.
          if (asked === mine) set({ user: next, answer: null, pending: false });
        },
      );
    },
    refresh() {
      const user = state.user;
      if (user === null) return Promise.resolve(null);
      const mine = ++asked;
      return fetch().then(
        (answer) => {
          if (asked === mine) set({ user, answer, pending: false });
          return answer;
        },
        () => {
          if (asked === mine && state.pending) set({ ...state, pending: false });
          return null;
        },
      );
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
 * `renderers`.
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
    const { key, nav, admin, released } = entry;
    if (typeof key !== "string" || key === "" || keys.has(key)) continue;
    if (typeof entry.path !== "string") continue;
    const org = nav === "org";
    const path = org ? entry.path.replace(/^\/+/, "") : entry.path;
    if (org ? path === "" : !path.startsWith("/")) continue;
    const rooted = org ? `/${path}` : path;
    if (paths.has(rooted)) continue;
    const renderer = rendererOf(entry.renderer);
    if (renderer === null) continue;
    const Component =
      "iframe" in renderer
        ? framePageFor(renderer.iframe.src, key)
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
      released: released !== false,
      order: ++order,
      renderer,
      Component,
    });
  }
  return out;
}

/** The answer's parts besides the pages, for the features that read them (web-app/index.ts). */

/** Holds the signed-in user's contributions and the merged page table, for everything under the router. */
export function WebAppPagesProvider({ children }: { children: ReactNode }) {
  const { pages: compiled, pageRenderers } = webAppDeps.useDeps();
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
      pages: contributedPagesOf(compiled, answer, pageRenderers),
      pending,
      // A mocked or older server may leave these out.
      quickStarts: [],
      refresh: store.refresh,
    }),
    [compiled, answer, pageRenderers, pending, store],
  );
  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>;
}

export { useContributions, useWebAppPages, useWebAppPagesPending } from "../lib/web-app-pages";
export type { ContributionsValue } from "../lib/web-app-pages";
