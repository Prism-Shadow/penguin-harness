import { fetchJson } from "../features/terminal/terminal-view";

type SessionResourceKind = "terminal" | "builtin-browser";

function managementPath(kind: SessionResourceKind, projectId: string) {
  const prefix = kind === "terminal" ? "/api/terminals" : "/api/builtin-browser";
  return `${prefix}/projects/${encodeURIComponent(projectId)}/session-resources`;
}

/** These routes authenticate a signed-in human. Use the cookie-bearing HTTP route on the target machine. */
export async function listSessionResourceCounts(
  kind: SessionResourceKind,
  projectId: string,
  machineId: string | null,
): Promise<Record<string, number>> {
  const { counts } = await fetchJson<{ counts: Record<string, number> }>(
    managementPath(kind, projectId), undefined, machineId,
  );
  return counts;
}

export function closeSessionResources(
  kind: SessionResourceKind,
  projectId: string,
  machineId: string | null,
  sessionIds: readonly string[],
): Promise<{ results: Array<{ sessionId: string; closed: number; error?: string }> }> {
  return fetchJson(managementPath(kind, projectId) + "/close", {
    method: "POST",
    body: JSON.stringify({sessionIds}),
  },machineId);
}
