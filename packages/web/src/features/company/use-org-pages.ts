/**
 * The page table with what the server's plugins contribute folded in (GET /api/contributions,
 * lib/pages.ts `mergePages`) — read here for its company-mode pages (`nav: "org"`): the router
 * mounts them under the organization layout and the sidebar draws their rows.
 *
 * One fetch per signed-in user, shared by every caller through a module-level store. Until it
 * answers — and if it never does — the table is the local manifest alone: no contributed page
 * is load-bearing.
 *
 * TODO(contributions-provider): the web UI stack's state/contributions.tsx (ContributionsProvider,
 * which also carries the session surfaces) holds this same merged table for the whole tree. Once
 * both stacks are on one line, read `useContributions().pages` instead and delete this module.
 */
import { useEffect, useSyncExternalStore } from "react";
import * as api from "../../api/endpoints";
import { PAGES, mergePages, type PageEntry } from "../../lib/pages";
import { useAuth } from "../../state/auth";
import { ORG_PAGE_RENDERERS } from "./company-nav";

/** The builtin renderers a contributed company-mode page may name; one naming another is skipped. */
const ORG_RENDERER_NAMES: ReadonlySet<string> = new Set(Object.keys(ORG_PAGE_RENDERERS));

let loadedFor: string | null = null;
let pages: readonly PageEntry[] = PAGES;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(userId: string | null): void {
  if (userId === loadedFor) return;
  loadedFor = userId;
  pages = PAGES;
  listeners.forEach((l) => l());
  if (userId === null) return;
  api.getContributions().then(
    (res) => {
      if (loadedFor !== userId) return;
      pages = mergePages(PAGES, res.pages, ORG_RENDERER_NAMES);
      listeners.forEach((l) => l());
    },
    () => {
      // Nothing to fold in: the App stays on its local manifest, which is a complete App.
    },
  );
}

/** The merged page table (local manifest plus contributed pages this build can render). */
export function useOrgPages(): readonly PageEntry[] {
  const userId = useAuth().user?.userId ?? null;
  useEffect(() => load(userId), [userId]);
  return useSyncExternalStore(subscribe, () => pages);
}
