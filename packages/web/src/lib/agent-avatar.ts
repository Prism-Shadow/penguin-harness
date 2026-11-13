/**
 * Where an Agent's own picture is, for every surface that draws the Agent: the one lookup.
 *
 * Most of those surfaces know an Agent by its id alone — a session row, a subagent chip, a
 * topology node, a picker row, a Benchmark's tested Agents — so the picture is found here, in
 * the Agent lists the page already holds: this server's (state/project.tsx), and each machine's
 * as last read there (lib/machine-agent-lists.ts), since the same id on a machine is another
 * Agent. A list's `avatarRev` names the picture; the URL is built here and nowhere else, and an
 * Agent without one gets no URL, so `AgentAvatar` draws its default.
 *
 * Nothing is asked of any server for this: a list nobody on the page has read yet simply has no
 * picture to give, and the default shows until it does — as it does outside a Project.
 */
import { useCallback } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { useProjectIfAny } from "../state/project";
import { useHeldMachineAgents } from "./machine-agent-lists";

const NO_AGENTS: readonly AgentSummary[] = [];

/** The Agent's own picture, or undefined to draw the default; `machineId` null is this server. */
export type AgentAvatarSrc = (agentId: string, machineId?: string | null) => string | undefined;

/** The picture of `agentId` in `agents`, as a URL on `machineId`. */
function avatarSrcIn(
  agents: readonly AgentSummary[],
  projectId: string,
  agentId: string,
  machineId: string | null,
): string | undefined {
  const rev = agents.find((a) => a.agentId === agentId)?.avatarRev;
  return rev === undefined ? undefined : api.agentAvatarUrl(projectId, agentId, rev, machineId);
}

/** The lookup, over the current Project's lists. */
export function useAgentAvatarSrc(): AgentAvatarSrc {
  const project = useProjectIfAny();
  const projectId = project?.currentProject?.projectId ?? null;
  const agents = project?.agents ?? NO_AGENTS;
  const machines = useHeldMachineAgents(projectId);
  return useCallback(
    (agentId, machineId = null) => {
      if (projectId === null) return undefined;
      const list = machineId === null ? agents : (machines.get(machineId) ?? []);
      return avatarSrcIn(list, projectId, agentId, machineId);
    },
    [projectId, agents, machines],
  );
}
