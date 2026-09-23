/**
 * Switching the model of a DESK.
 *
 * `/model` in an ordinary conversation forks it: a new Session of the same Agent on the picked
 * model, and the old one stays where it was. A desk is not a conversation that can be forked —
 * it is the employee's standing Session, the one its calendar rounds and @mentions are sent
 * to, recorded in `desks.toml`. Forking it left the organization on the old Session and the old
 * model while the person talked to a stray one that no page of the organization lists.
 *
 * So on a desk the switch is the employee's: its model is written to the chart (what every
 * later desk and ticket Session of that employee is opened on), and the desk is renewed — a
 * new desk Session on that model, recorded as the desk, the previous one kept in its history.
 */
import type { ModelRefDto, OrgDeskResponse } from "@prismshadow/penguin-server/api";

/** The three calls this needs, so a test can stand in for the API. */
export interface DeskModelApi {
  getOrgDesk(projectId: string, orgId: string, agentId: string): Promise<OrgDeskResponse>;
  patchOrgEmployee(
    projectId: string,
    orgId: string,
    agentId: string,
    body: { model: ModelRefDto },
  ): Promise<unknown>;
  renewOrgDesk(projectId: string, orgId: string, agentId: string): Promise<OrgDeskResponse>;
}

/**
 * Switches the employee's model and renews its desk; resolves to the NEW desk Session's id.
 * Null when `sessionId` is not that employee's current desk — a ticket's work Session, or a
 * desk already replaced — and the caller forks as it would anywhere else.
 */
export async function switchDeskModel(
  api: DeskModelApi,
  at: { projectId: string; orgId: string; agentId: string; sessionId: string },
  ref: ModelRefDto,
): Promise<string | null> {
  const desk = await api.getOrgDesk(at.projectId, at.orgId, at.agentId).catch(() => null);
  if (desk === null || desk.sessionId !== at.sessionId) return null;
  await api.patchOrgEmployee(at.projectId, at.orgId, at.agentId, { model: ref });
  return (await api.renewOrgDesk(at.projectId, at.orgId, at.agentId)).sessionId;
}
