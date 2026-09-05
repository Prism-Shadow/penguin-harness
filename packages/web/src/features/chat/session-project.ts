import type { SessionInfo } from "@prismshadow/penguin-server/api";

/**
 * The Session the route names: the loaded list's row when it holds one, otherwise the row a
 * direct lookup produced.
 *
 * Both halves are load-bearing. The list is paged, so a deep-linked conversation may sit
 * beyond the fetched pages; and it is replaced wholesale by every reload, which drops a row
 * that was merged in by such a lookup — an organization's desk, opened from the org chart,
 * is exactly that row, and losing it again is what left the conversation behind the skeleton
 * for good. The list row still WINS where it exists: it is the one the status and title
 * events keep current.
 */
export function resolveRoutedSession(
  sessionId: string | null,
  sessions: readonly SessionInfo[],
  fetched: SessionInfo | null,
): SessionInfo | null {
  if (sessionId === null) return null;
  const row = sessions.find((s) => s.sessionId === sessionId);
  if (row !== undefined) return row;
  return fetched !== null && fetched.sessionId === sessionId ? fetched : null;
}

/** Return a probed Session only when it belongs to the Project currently shown by the UI. */
export function sessionForProject(session: SessionInfo, projectId: string): SessionInfo | null {
  return session.projectId === projectId ? session : null;
}

/** Scope probe failures to a Project as well as a Session so switching Projects cannot reuse one. */
export function sessionProbeKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}
