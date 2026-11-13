/**
 * An employee's avatar on a company surface: the picture the organization gave it, else the
 * Agent's own picture, else the Agent's default avatar (the mascot, in the Agent's colour).
 *
 * The organization's picture (its `avatars/` directory) comes first, like the employee's name:
 * the same Agent may be pictured differently here than anywhere else, and only here. It is looked
 * up in the open organization's chart rather than passed down by every caller — a channel
 * message, a desk row and a ticket all name an employee by id only — and the Agent's own in the
 * Agent list, through the one lookup every surface uses (lib/agent-avatar.ts).
 */
import * as api from "../../api/endpoints";
import { AgentAvatar, CHANNEL_RUN_AVATAR_PX } from "@prismshadow/penguin-ui";
import { useAgentAvatarSrc } from "../../lib/agent-avatar";
import { useCompany } from "./company-state";

/**
 * How large a face is drawn, by where it sits. These are a chat product's rungs rather than
 * the icon scale's: a face is how a reader finds a PERSON in a list or a conversation, and at
 * a line glyph's 14px a picture is a smudge. A list row carries one that still fits a one-line
 * row; a message run is led by one large enough to recognise at a glance, as every messenger
 * does it.
 */
export const FACE_PX = {
  /** A row of a list: the sidebar's desks, a channel's members. */
  row: 22,
  /** The collapsed sidebar's rail, where the face is the whole row. */
  rail: 24,
  /** The avatar that leads somebody's run of messages: the UI package's run tile, which a
   * person's initial is drawn at too. */
  message: CHANNEL_RUN_AVATAR_PX,
} as const;

/** The picture an employee is drawn with on a company surface; undefined draws the default. */
export function useEmployeeAvatarSrc(): (agentId: string) => string | undefined {
  const { currentOrg, orgChart } = useCompany();
  const agentPicture = useAgentAvatarSrc();
  return (agentId) => {
    const rev = orgChart?.employees.find((e) => e.agentId === agentId)?.avatarRev;
    if (currentOrg !== null && rev !== undefined) {
      return api.orgEmployeeAvatarUrl(currentOrg.projectId, currentOrg.orgId, agentId, rev);
    }
    return agentPicture(agentId);
  };
}

export function EmployeeAvatar({
  id,
  size = 18,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const pictureOf = useEmployeeAvatarSrc();
  return (
    <AgentAvatar
      id={id}
      size={size}
      src={pictureOf(id)}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
