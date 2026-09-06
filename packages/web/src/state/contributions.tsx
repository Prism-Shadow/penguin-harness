/**
 * What the server's modules and plugins contribute to this App: GET /api/contributions,
 * fetched once per signed-in user and held for the whole tree.
 *
 * Two things come out of it. `pages` is the local manifest with the server's page
 * contributions folded in (lib/pages.ts `mergePages`) — the router mounts the result, so a
 * page a pushed platform or a plugin contributes opens as long as this build carries its
 * renderer. `surfaces` is the list of session surfaces (see the chat page's
 * session-surface-view.tsx): what "New chat" offers beyond the conversation, and what a
 * Session of that kind is drawn with.
 *
 * Until the fetch answers — and if it never does — the App is exactly what it is today:
 * local pages only, no surfaces. A contributed page is never load-bearing for signing in.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ContributionsResponse, SessionSurfaceSummary } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { PAGES, mergePages, type PageEntry } from "../lib/pages";
import { useAuth } from "./auth";
import type { Locale } from "./locale";

interface ContributionsValue {
  pages: readonly PageEntry[];
  surfaces: readonly SessionSurfaceSummary[];
  /** Whether the server has answered (false = local manifest only, so far). */
  loaded: boolean;
}

const LOCAL: ContributionsValue = { pages: PAGES, surfaces: [], loaded: false };

const ContributionsContext = createContext<ContributionsValue>(LOCAL);

export function ContributionsProvider({
  builtinRenderers,
  children,
}: {
  /** The page renderers this build carries (the router's registry); a contributed page naming another is skipped. */
  builtinRenderers: ReadonlySet<string>;
  children: ReactNode;
}) {
  const userId = useAuth().user?.userId ?? null;
  const [remote, setRemote] = useState<ContributionsResponse | null>(null);
  useEffect(() => {
    if (userId === null) {
      setRemote(null);
      return;
    }
    let alive = true;
    api.getContributions().then(
      (res) => {
        if (alive) setRemote(res);
      },
      () => {
        // Nothing to fold in: the App stays on its local manifest, which is a complete App.
      },
    );
    return () => {
      alive = false;
    };
  }, [userId]);
  const value = useMemo<ContributionsValue>(
    () =>
      remote === null
        ? LOCAL
        : {
            pages: mergePages(PAGES, remote.pages, builtinRenderers),
            surfaces: remote.sessionSurfaces ?? [],
            loaded: true,
          },
    [remote, builtinRenderers],
  );
  return <ContributionsContext.Provider value={value}>{children}</ContributionsContext.Provider>;
}

export function useContributions(): ContributionsValue {
  return useContext(ContributionsContext);
}

/** The "New chat" entry's text for a surface, in the interface's language. */
export function surfaceLabel(surface: SessionSurfaceSummary, locale: Locale): string {
  return locale === "zh" ? (surface.labelZh ?? surface.label) : surface.label;
}
