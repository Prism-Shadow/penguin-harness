import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
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

/** The component a contributed page's renderer resolves to; undefined when this build cannot draw it. */
function componentOf(
  renderer: unknown,
  key: string,
  renderers: ReadonlyMap<string, ComponentType>,
): ComponentType | undefined {
  const ref = renderer as { iframe?: { src?: unknown }; builtin?: unknown } | undefined;
  if (typeof ref?.iframe?.src === "string") return framePageFor(ref.iframe.src, key);
  if (typeof ref?.builtin === "string") return renderers.get(ref.builtin);
  return undefined;
}

/**
 * The compiled pages plus the contributed ones this build can draw, appended in the server's
 * order after the last compiled page. An entry is skipped when it lacks a key or a path, when
 * a compiled page (or an earlier entry) owns its key or path, or when its renderer is neither
 * an iframe with a `src` nor a `builtin` name in `renderers`.
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
    const { key, path, nav, admin, renderer } = entry;
    if (typeof key !== "string" || key === "" || keys.has(key)) continue;
    if (typeof path !== "string" || !path.startsWith("/") || paths.has(path)) continue;
    const Component = componentOf(renderer, key, renderers);
    if (Component === undefined) {
      console.warn(
        `Missing builtin renderer "${"builtin" in renderer ? renderer.builtin : ""}" for contributed page "${key}" (${path}); skipping page`,
      );
      continue;
    }
    keys.add(key);
    paths.add(path);
    out.push({
      id: entry.id,
      key,
      path,
      frame: "shell",
      nav: nav === "main" ? "main" : "none",
      admin: admin === true,
      released: true,
      order: ++order,
      Component,
    });
  }
  return out;
}

/** Holds the signed-in user's contributions and the merged page table, for everything under the router. */
export function WebAppPagesProvider({ children }: { children: ReactNode }) {
  const { pages: compiled, pageRenderers } = webAppDeps.useDeps();
  const userId = useAuth().user?.userId ?? null;
  const [store] = useState(() => createContributionsStore(api.getContributions));
  useEffect(() => store.setUser(userId), [store, userId]);
  const state = useSyncExternalStore(store.subscribe, store.current);
  // Until the effect above has told the store about a new user, the state is the last user's:
  // none of it is shown, and the new user's request counts as already in flight.
  const current = state.user === userId;
  const answer = current ? state.answer : null;
  const pending = current ? state.pending : userId !== null;
  const value = useMemo(
    () => ({ pages: contributedPagesOf(compiled, answer, pageRenderers), pending }),
    [compiled, answer, pageRenderers, pending],
  );
  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>;
}
import { PagesContext } from "../lib/local-web-app-pages";
export { useWebAppPages, useWebAppPagesPending } from "../lib/local-web-app-pages";
