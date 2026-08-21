/**
 * The Agent's memory listing (overview + every scope's files), owned by chat-page and
 * shared by two consumers: the Memory panel's list/detail views, and the memory-changes
 * card's deleted-row filtering (a changed file the loaded listing doesn't carry no longer
 * exists, so the card drops its rows — see memory-nav.ts deletedChangeKeys).
 *
 * Fetches only when wanted (the panel is open, or this conversation has memory changes to
 * mark), and refetches when `changes` moves — the caller passes an identity-stable array
 * (see chat-page's stabilization), so streaming ticks never re-fire this.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import type { ScopeFiles } from "./memory-nav";

export function useMemoryListing(
  projectId: string | null,
  agentId: string | null,
  wanted: boolean,
  changes: readonly MemoryChangeRow[],
): { scopes: ScopeFiles[] | null; error: string | null } {
  const [state, setState] = useState<{
    forAgent: string | null;
    scopes: ScopeFiles[] | null;
    error: string | null;
  }>({ forAgent: null, scopes: null, error: null });

  useEffect(() => {
    if (!wanted || projectId === null || agentId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const overview = await api.getMemoryOverview(projectId, agentId);
        const scopes = await Promise.all(
          overview.scopes.map(async (info) => ({
            info,
            files: (await api.getMemoryFiles(projectId, agentId, info.scopeKey)).files,
          })),
        );
        if (!cancelled) setState({ forAgent: agentId, scopes, error: null });
      } catch (err) {
        if (!cancelled) setState({ forAgent: agentId, scopes: null, error: apiErrorText(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, projectId, agentId, changes]);

  // A listing loaded for another Agent is not this Agent's memory — report it as not loaded
  // rather than briefly showing (and delete-marking against) the wrong tree.
  if (state.forAgent !== agentId) return { scopes: null, error: null };
  return { scopes: state.scopes, error: state.error };
}
