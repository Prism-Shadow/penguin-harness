import * as api from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import type { MemoryChangeRow } from "@prismshadow/penguin-web/internal";

import type { ScopeFiles } from "./memory-nav";
import { scopeKey } from "@prismshadow/penguin-web/internal";

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
          overview.scopes.map(async (info) => {
            const listed = await api.getMemoryFiles(projectId, agentId, info.scopeKey, machineId);
            return { info, files: listed.files, orphanFiles: listed.orphanFiles };
          }),
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
