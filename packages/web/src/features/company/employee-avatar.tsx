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
