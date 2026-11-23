import { apiFetch } from "../api/client";
import { apiUrl } from "./server-context";

type SessionResourceKind = "terminal" | "builtin-browser";

function managementUrl(kind: SessionResourceKind, projectId: string, machineId: string | null) {
  const prefix = kind === "terminal" ? "/api/terminals" : "/api/builtin-browser";
  return apiUrl(`${prefix}/projects/${encodeURIComponent(projectId)}/session-resources`, machineId);
}

export async function listSessionResourceCounts(
  kind: SessionResourceKind,
  projectId: string,
  machineId: string | null,
): Promise<Record<string, number>> {
  const { counts } = await apiFetch<{ counts: Record<string, number> }>(
    managementUrl(kind, projectId, machineId),
  );
  return counts;
}

export function closeSessionResources(
  kind: SessionResourceKind,
  projectId: string,
  machineId: string | null,
  sessionIds: readonly string[],
): Promise<{ results: Array<{ sessionId: string; closed: number; error?: string }> }> {
  return apiFetch(managementUrl(kind, projectId, machineId) + "/close", {
    method: "POST",
    body: { sessionIds },
  });
}
