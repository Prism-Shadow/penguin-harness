/**
 * What the server contributed to the web slots (GET /api/contributions) — pages a pushed
 * platform or an installed plugin adds. Loaded once per signed-in user, held here, and
 * folded into the local page manifest by `usePages` (lib/pages.ts `mergePages`).
 *
 * Only the router consumes it today: a contributed page is reachable at its route. The
 * sidebar's nav stays the local manifest's — its entries are typed keys with a label and
 * an icon behind each, which the pages slot does not carry, so a contributed page has
 * nothing to show there yet.
 */
import { useSyncExternalStore } from "react";
import { apiFetch } from "../api/client";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";

const EMPTY: ContributionsResponse = { pages: [], agentTabs: [], sessionTabs: [] };

let current: ContributionsResponse = EMPTY;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

/**
 * Fetches the contributions for this user, once per sign-in. A failure leaves the
 * local manifest in force — the app is complete without contributions, and the next
 * sign-in tries again.
 */
export async function loadContributions(userId: string): Promise<void> {
  if (loadedFor === userId) return;
  loadedFor = userId;
  try {
    current = await apiFetch<ContributionsResponse>("/api/contributions");
  } catch {
    loadedFor = null;
    return;
  }
  for (const listener of listeners) listener();
}

/** For a sign-out: the next user starts from the local manifest. */
export function resetContributions(): void {
  current = EMPTY;
  loadedFor = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The contributions as last loaded; the empty set before that. */
export function useContributions(): ContributionsResponse {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
}
