/**
 * The pages the server's plugins contribute that this build can render (GET /api/contributions,
 * web-app/page-table.ts `contributedPages`) — read here for its company-mode pages (`nav: "org"`):
 * company mode routes them under the organization layout (org-routes.tsx) and the sidebar draws
 * their rows.
 *
 * One fetch per signed-in user, shared by every caller through a module-level store. Until it
 * answers — and if it never does — there are none: no contributed page is load-bearing.
 * {@link useOrgPagesState} says which of the two a caller is looking at, so a route can tell
 * "not contributed" from "not asked yet".
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
import { ORG_PAGE_RENDERERS } from "./company-nav";

/** The builtin renderers a contributed company-mode page may name; one naming another is skipped. */
const ORG_RENDERER_NAMES: ReadonlySet<string> = new Set(Object.keys(ORG_PAGE_RENDERERS));

type RemotePages = ReadonlyArray<Record<string, unknown>>;

/**
 * How far the contributed table has got: nobody signed in to ask for (`idle`), the contributions
 * are on their way (`loading`), they answered (`ready`), or the request failed and the table
 * stays on the local pages alone (`error`). Only `ready` and `error` have settled the table:
 * until then a page missing from it may still arrive, so a lookup must not read a miss as
 * "there is no such page".
 */
export type OrgPagesStatus = "idle" | "loading" | "ready" | "error";

export interface OrgPagesState {
  /** The contributed pages this build can render: none until the server's answer arrives. */
  pages: readonly PageEntry[];
  status: OrgPagesStatus;
}

let loadedFor: string | null = null;
let state: OrgPagesState = { pages: [], status: "idle" };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replaces the store's state; the object identity is what `useSyncExternalStore` compares. */
function publish(next: OrgPagesState): void {
  state = next;
  listeners.forEach((l) => l());
}

function load(userId: string | null): void {
  if (userId === loadedFor) return;
  loadedFor = userId;
  publish({ pages: [], status: userId === null ? "idle" : "loading" });
  if (userId === null) return;
  api.getContributions().then(
    (res) => {
      if (loadedFor !== userId) return;
      publish({ pages: res.pages, status: "ready" });
    },
    () => {
      // Nothing to fold in: the App stays on its own pages, which make a complete App.
      // The table is settled all the same — a page it does not hold is not coming.
      if (loadedFor !== userId) return;
      publish({ pages: [], status: "error" });
    },
  );
}

function useOrgPagesStore(): OrgPagesState {
  const userId = useAuth().user?.userId ?? null;
  useEffect(() => load(userId), [userId]);
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * The contributed pages this build can render beside the app's own — the merged view the
 * sidebar's rows and the organization layout route read.
 */
export function useOrgPages(): readonly PageEntry[] {
  const { pages } = useOrgPagesStore();
  const local = useWebAppPages();
  return useMemo(() => contributedPages(local, pages, ORG_RENDERER_NAMES), [local, pages]);
}

/**
 * The contributed table with how far its fetch has got. A route that mounts a contributed page
 * waits for the table to settle before it treats a page it cannot find as absent: a cold deep
 * link is routed before the contributions answer, and sending it to the fallback then would
 * lose it for the rest of the visit.
 */
export function useOrgPagesState(): OrgPagesState {
  const store = useOrgPagesStore();
  const local = useWebAppPages();
  return useMemo(
    () => ({
      pages: contributedPages(local, store.pages, ORG_RENDERER_NAMES),
      status: store.status,
    }),
    [local, store],
  );
}
