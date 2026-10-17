/**
 * The pages the server's plugins contribute that this build can render (GET /api/contributions,
 * web-app/page-table.ts `contributedPages`) — read here for its company-mode pages (`nav: "org"`):
 * company mode routes them under the organization layout (org-routes.tsx) and the sidebar draws
 * their rows.
 *
 * One fetch per signed-in user, shared by every caller through a module-level store. Until it
 * answers — and if it never does — there are none: no contributed page is load-bearing.
 *
 * TODO(contributions-provider): the web UI stack's state/contributions.tsx (ContributionsProvider,
 * which also carries the session surfaces) holds the same contributed pages for the whole tree.
 * Once both stacks are on one line, read `useContributions().pages` instead and delete this module.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as api from "../../api/endpoints";
import { useWebAppPages } from "../../web-app";
import { contributedPages, type PageEntry } from "../../web-app/page-table";
import { useAuth } from "../../state/auth";

/** The builtin renderers a contributed company-mode page may name; one naming another is skipped. */
const ORG_RENDERER_NAMES: ReadonlySet<string> = new Set();

type RemotePages = ReadonlyArray<Record<string, unknown>>;

let loadedFor: string | null = null;
let remote: RemotePages = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(userId: string | null): void {
  if (userId === loadedFor) return;
  loadedFor = userId;
  remote = [];
  listeners.forEach((l) => l());
  if (userId === null) return;
  api.getContributions().then(
    (res) => {
      if (loadedFor !== userId) return;
      remote = res.pages;
      listeners.forEach((l) => l());
    },
    () => {
      // Nothing to fold in: the App stays on its own pages, which make a complete App.
    },
  );
}

/** The contributed pages this build can render beside the app's own. */
export function useOrgPages(): readonly PageEntry[] {
  const userId = useAuth().user?.userId ?? null;
  const local = useWebAppPages();
  useEffect(() => load(userId), [userId]);
  const pages = useSyncExternalStore(subscribe, () => remote);
  return useMemo(() => contributedPages(local, pages, ORG_RENDERER_NAMES), [local, pages]);
}
