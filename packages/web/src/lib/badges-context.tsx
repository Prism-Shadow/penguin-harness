/**
 * The badges on the sidebar's anchors (`SidebarModule.navBadges`), read from one owner.
 *
 * `UpdateBadgesProvider` is mounted for the signed-in session (`WebAppModule.sessionProviders`),
 * around the app layout: it is the single eager instance of `useUpdateBadges`, the one that
 * fetches — one request per browser session, so a dot can be there on a fresh load instead of
 * waiting for someone to open the sidebar menu. Every anchor of the sidebar, the rail and the
 * phone's drawer button reads its answer here; the pages that clear a trail read the same caches
 * passively through their own `useUpdateBadges()`.
 */
import { createContext, useContext, type ReactNode } from "react";

import type { NavBadge } from "./sidebar-contributions";
import { navNoteFor, useUpdateBadges, type UpdateBadges } from "./use-update-badges";

const BadgesContext = createContext<UpdateBadges | null>(null);

export function UpdateBadgesProvider({ children }: { children: ReactNode }) {
  const badges = useUpdateBadges(true);
  return <BadgesContext.Provider value={badges}>{children}</BadgesContext.Provider>;
}

function useBadges(): UpdateBadges {
  const badges = useContext(BadgesContext);
  if (badges === null) throw new Error("a nav badge rendered outside the update badges' provider");
  return badges;
}

/** A page row's dot: what that page's trail is waiting on. */
const pageBadge = (key: string): NavBadge => ({
  useNote: () => navNoteFor(useBadges(), `/${key}`),
});

/**
 * The four page trails — Agents (an outdated kernel, fixed on the Agent settings page two clicks
 * down), Plugins, Models and the Cost Center (each cleared on the page itself) — the account
 * row's software update, in the update row's own wording, and the drawer button, which covers
 * every trail and so says the combined note (naming one of two would point at the wrong trail).
 */
export const agentsBadge = pageBadge("agents");
export const pluginsBadge = pageBadge("plugins");
export const modelsBadge = pageBadge("models");
export const usageBadge = pageBadge("usage");
export const accountBadge: NavBadge = { useNote: () => useBadges().softwareNote };
export const menuBadge: NavBadge = { useNote: () => useBadges().note };
