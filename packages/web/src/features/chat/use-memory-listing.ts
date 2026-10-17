/**
 * The Agent's memory listing (overview + every scope's files), owned by chat-page and
 * shared by two consumers: the Memory panel's list/detail views, and the memory-changes
 * card's deleted-row filtering (a changed file the loaded listing doesn't carry no longer
 * exists, so the card drops its rows — see memory-nav.ts deletedChangeKeys).
 *
 * Fetches only when wanted (the panel is open, or this conversation has memory changes to
 * mark), and refetches when `changes` moves — the caller passes an identity-stable array
 * (see chat-page's stabilization), so streaming ticks never re-fire this.
 *
 * Read from the server the conversation's Agent lives on: a Session on a machine runs that
 * machine's Agent, whose memory is over there (`machineId`; null for this server). An Agent of
 * the same id here is another Agent, and its memory is not this conversation's.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import type { ScopeFiles } from "./memory-nav";
import { scopeKey } from "../../lib/project-scope";

export function useMemoryListing(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null,
  wanted: boolean,
  changes: readonly MemoryChangeRow[],
): { scopes: ScopeFiles[] | null; error: string | null } {
  /**
   * The Agent a listing is about: its id in its Project, on the server that holds it. The
   * Project is part of it — every Project has a `default_agent`, and one Project's memory
   * shown under another's is that other Agent's memory, delete marks and all.
   */
  const agentKey = scopeKey(projectId, agentId, machineId);
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
        const overview = await api.getMemoryOverview(projectId, agentId, machineId);
        const scopes = await Promise.all(
          overview.scopes.map(async (info) => ({
            info,
            files: (await api.getMemoryFiles(projectId, agentId, info.scopeKey, machineId)).files,
          })),
        );
        if (!cancelled) setState({ forAgent: agentKey, scopes, error: null });
      } catch (err) {
        if (!cancelled) setState({ forAgent: agentKey, scopes: null, error: apiErrorText(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, projectId, agentId, machineId, agentKey, changes]);

  // A listing loaded for another Agent — or for this id on another server — is not this
  // Agent's memory: report it as not loaded rather than briefly showing (and delete-marking
  // against) the wrong tree.
  if (state.forAgent !== agentKey) return { scopes: null, error: null };
  return { scopes: state.scopes, error: state.error };
}
