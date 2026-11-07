import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as api from "../../api/endpoints";
import { useWebAppPages } from "../../lib/early-frame-index";
import { contributedPages, type PageEntry } from "../../lib/early-frame-page-table";
import { useAuth } from "../../state/auth";
import { ORG_PAGE_RENDERERS } from "../../lib/company-nav";

/** The builtin renderers a contributed company-mode page may name; one naming another is skipped. */
const ORG_RENDERER_NAMES: ReadonlySet<string> = new Set(Object.keys(ORG_PAGE_RENDERERS));

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
