/**
 * What the open conversation reads off its Agent: the installed Skills (the composer's skill
 * dropdown), and the configured thinking level and compaction threshold, re-read on focus.
 */
import { useCallback, useEffect, useState } from "react";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import { toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { configuredCompactionLimit } from "../../../lib/context";
import { humanizeTokens } from "../../../lib/format";

/**
 * The machine the selected Session's Agent lives on (null: this server). A Session on a
 * machine runs that machine's Agent: its settings — the thinking level and compaction threshold
 * the composer shows and edits, the settings page it links to — are that Agent's, read and
 * written over there. The same id on this server is another Agent.
 */
export function useAgentConfig(
  projectId: string | null,
  selectedAgentId: string | null,
  selectedAgentMachine: string | null,
) {
  // Skills installed on the session's Agent (candidates for the input area's skill dropdown):
  // fetched keyed on the session's Agent; on switch, cleared first (which also clears the input
  // area's selection) before refetching; a failed fetch is silently treated as no skills.
  // Clearing preserves reference identity (an already-empty array isn't replaced), matching
  // draft-view's convention.
  const [agentSkills, setAgentSkills] = useState<SkillMetadataItem[]>([]);
  useEffect(() => {
    setAgentSkills((prev) => (prev.length > 0 ? [] : prev));
    if (!projectId || !selectedAgentId) return;
    let cancelled = false;
    api
      .getAgentSkills(projectId, selectedAgentId)
      .then((res) => {
        if (!cancelled) setAgentSkills(res.skills);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAgentId]);

  // Two readouts come off the session Agent's config, via the same agent-config endpoint the
  // draft picker uses. The configured thinking level ("" = unset/loading) is what the in-session
  // picker DISPLAYS while the user hasn't picked a level (auto-follow — sending still omits the
  // level until touched, see turnThinkingLevel). The configured compaction threshold is the
  // basis the composer's context ring fills against, and the number its small-window notice is
  // judged against. A failed fetch leaves both unset (the picker shows an em dash until picked;
  // the ring falls back to the model window and the notice stays down).
  const [agentThinkingLevel, setAgentThinkingLevel] = useState("");
  const [compactionLimit, setCompactionLimit] = useState<number | undefined>(undefined);
  // Cleared on an Agent switch only. A plain refresh must not blank values that are about to
  // come back unchanged: doing that inside the fetch effect would flash the thinking picker's
  // em dash and drop the ring to the window basis on every refetch.
  useEffect(() => {
    setAgentThinkingLevel("");
    setCompactionLimit(undefined);
  }, [projectId, selectedAgentId, selectedAgentMachine]);
  // Re-read on focus as well as on an Agent switch: the threshold is edited on another page, so
  // the value this composer holds can go stale under it. Routing to the settings page and back
  // remounts this page and refetches anyway; the focus listener covers the other tab editing the
  // same Agent. (`models` has no such refresh — a model entry is not edited mid-conversation the
  // way a threshold is, and it already listens for its own change event.)
  const [agentConfigTick, setAgentConfigTick] = useState(0);
  useEffect(() => {
    const onFocus = () => setAgentConfigTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (!projectId || !selectedAgentId) return;
    let cancelled = false;
    api
      .getAgentConfig(projectId, selectedAgentId, selectedAgentMachine)
      .then((res) => {
        if (cancelled) return;
        setAgentThinkingLevel(res.config.model?.thinkingLevel ?? "");
        setCompactionLimit(configuredCompactionLimit(res.config.compaction?.maxContextLength));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAgentId, selectedAgentMachine, agentConfigTick]);
  /**
   * Commits the threshold the context panel's cutter proposed, then re-reads the Agent config
   * this page holds so the ring, the cutter and the small-window notice all move together.
   *
   * Compaction settings are re-read by the engine at every compaction checkpoint, so this
   * applies to the conversation on screen without waiting for a rotation — which is what the
   * toast says. Rejecting rather than swallowing the failure is what keeps the dialog open on
   * the value the user typed.
   */
  const onChangeCompactionLimit = useCallback(
    async (maxContextLength: number): Promise<void> => {
      if (!projectId || !selectedAgentId) return;
      try {
        await api.putAgentConfig(
          projectId,
          selectedAgentId,
          { config: { compaction: { maxContextLength } } },
          selectedAgentMachine,
        );
      } catch (e) {
        toastError(apiErrorText(e));
        throw e;
      }
      setCompactionLimit(configuredCompactionLimit(maxContextLength));
      setAgentConfigTick((n) => n + 1);
      toastSuccess(S.chat.contextThresholdSaved(humanizeTokens(maxContextLength)));
    },
    [projectId, selectedAgentId, selectedAgentMachine],
  );
  return { agentSkills, agentThinkingLevel, compactionLimit, onChangeCompactionLimit };
}
