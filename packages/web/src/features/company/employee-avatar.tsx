/**
 * An employee's avatar on a company surface: the picture the organization gave it, or the
 * Agent's letter tile when it has none.
 *
 * The picture is the organization's (its `avatars/` directory), like the employee's name, so
 * it is looked up in the open organization's chart rather than passed down by every caller —
 * a channel message, a desk row and a ticket all name an employee by id only.
 */
import * as api from "../../api/endpoints";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { useCompany } from "../../state/company";

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
  /** The avatar that leads somebody's run of messages. */
  message: 36,
} as const;

export function EmployeeAvatar({
  id,
  name,
  size = 18,
  className,
}: {
  id: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const { currentOrg, orgChart } = useCompany();
  const rev = orgChart?.employees.find((e) => e.agentId === id)?.avatarRev;
  if (currentOrg === null || rev === undefined) {
    return (
      <AgentAvatar
        id={id}
        {...(name !== undefined ? { name } : {})}
        size={size}
        {...(className !== undefined ? { className } : {})}
      />
    );
  }
  return (
    <img
      src={api.orgEmployeeAvatarUrl(currentOrg.projectId, currentOrg.orgId, id, rev)}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`object-cover ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
