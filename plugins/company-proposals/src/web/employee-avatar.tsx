/**
 * An employee's face: the organization's own avatar picture while the chart names a revision
 * for them, the shared agent tile (the palette's drawing, stable across surfaces) before it
 * does — an avatar is how a reader finds a PERSON, and the tile is the answer until the
 * picture exists to take its place.
 */
import { AgentAvatar } from "@prismshadow/penguin-ui";
import { orgEmployeeAvatarUrl } from "./api";
import { useCompany } from "./context";

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
      src={orgEmployeeAvatarUrl(currentOrg.projectId, currentOrg.orgId, id, rev)}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`object-cover ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
