/**
 * The Skills installed on an Agent, as a composer offers them (its skills dropdown and slash
 * menu): read from the machine the Agent lives on (`machineId`; null for this server). A Session
 * on a machine runs that machine's Agent, and this server's Agent of the same id is another
 * Agent with its own Skills.
 *
 * On a change of Agent or machine the list is cleared first, then read again. Clearing keeps the
 * same array when it is already empty: a new reference on the first render would fire the
 * composer's pruning effect and drop a skill preselected by a quick invoke. An answer to a
 * previous question is dropped, and a read that fails reads as no Skills. `loaded` says the read
 * for the current Agent settled, either way, for a caller that must wait for it (the draft's
 * example task pins `[use_skills]` only once it knows).
 */
import { useEffect, useState } from "react";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";

export function useAgentSkills(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null,
): { skills: SkillMetadataItem[]; loaded: boolean } {
  const [skills, setSkills] = useState<SkillMetadataItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setSkills((prev) => (prev.length > 0 ? [] : prev));
    setLoaded(false);
    if (!projectId || !agentId) return;
    let cancelled = false;
    api
      .getAgentSkills(projectId, agentId, machineId)
      .then((res) => {
        if (!cancelled) setSkills(res.skills);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, machineId]);
  return { skills, loaded };
}
