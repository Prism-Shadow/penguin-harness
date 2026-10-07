/**
 * The line a refused or failed proposal or roadmap write carries for an employee: the skill
 * that explains these writes and their errors, and how to load it. A person gets the error as
 * it is. Added once, where the registry answers a run (ActionRegistry.run), never per Action.
 */
import { ActionRefusal, type ActionCaller } from "./action-model.js";
import { PROPOSAL_SKILL } from "./skill-pack.js";

/** The hint for employee `agentId`: load the skill, the way an employee loads any skill. */
export function skillHint(agentId: string): string {
  return `If the \`${PROPOSAL_SKILL}\` skill is not loaded in this session, load it first: read \`<app_data_dir>/agents/${agentId}/agent_state/skills/${PROPOSAL_SKILL}/SKILL.md\` in full with read_file — it has the commands for this write and what this error means.`;
}

/** Whether a run request names a proposal or a roadmap Action, by key or by contribution. */
function isProposalWrite(req: { key?: string; contribution?: string }): boolean {
  if (req.key !== undefined)
    return req.key.startsWith("proposal.") || req.key.startsWith("roadmap.");
  const id = req.contribution ?? "";
  return id.startsWith("company-proposals.action.") || id.startsWith("company-roadmaps.action.");
}

/**
 * The error a run answered with, its message followed by the skill hint when the caller is an
 * employee and the write is a proposal or roadmap Action; anything else unchanged.
 */
export function withSkillHint(
  err: unknown,
  req: { key?: string; contribution?: string },
  caller: Pick<ActionCaller, "agentId">,
): unknown {
  if (!(err instanceof ActionRefusal) || caller.agentId === null || !isProposalWrite(req)) {
    return err;
  }
  const message =
    err.message === "" ? skillHint(caller.agentId) : `${err.message}\n${skillHint(caller.agentId)}`;
  return new ActionRefusal(err.status, err.code, message, err.details);
}
