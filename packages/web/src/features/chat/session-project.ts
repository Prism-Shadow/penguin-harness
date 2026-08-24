import type { SessionInfo } from "@prismshadow/penguin-server/api";

/** Return a probed Session only when it belongs to the Project currently shown by the UI. */
export function sessionForProject(session: SessionInfo, projectId: string): SessionInfo | null {
  return session.projectId === projectId ? session : null;
}

/** Scope probe failures to a Project as well as a Session so switching Projects cannot reuse one. */
export function sessionProbeKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}
