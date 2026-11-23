import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import { badRequest } from "./errors.js";

export interface SessionResourceAccess {
  access: Pick<Access, "requireProjectAccess">;
  sessions: Pick<SessionIndex, "findById">;
}

interface Resource<Id> {
  id: Id;
  sessionId?: string | null;
}

export function countSessionResources<Id>(
  auth: SessionResourceAccess,
  userId: string,
  projectId: string,
  list: () => readonly Resource<Id>[],
): { counts: Record<string, number> } {
  auth.access.requireProjectAccess(userId, projectId);
  const counts = new Map<string, number>();
  for (const { sessionId } of list()) {
    if (sessionId && auth.sessions.findById(sessionId)?.projectId === projectId) {
      counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
    }
  }
  return { counts: Object.fromEntries(counts) };
}

export async function closeSessionResources<Id>(
  auth: SessionResourceAccess,
  userId: string,
  projectId: string,
  selected: unknown,
  list: () => readonly Resource<Id>[],
  close: (id: Id, sessionId: string) => Promise<boolean | void> | boolean | void,
): Promise<{ results: Array<{ sessionId: string; closed: number; error?: string }> }> {
  auth.access.requireProjectAccess(userId, projectId);
  if (
    !Array.isArray(selected) ||
    !selected.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    throw badRequest("sessionIds must be a list of non-empty Session IDs.");
  }
  const resources = list();
  const results = [];
  for (const sessionId of new Set(selected)) {
    if (auth.sessions.findById(sessionId)?.projectId !== projectId) {
      results.push({ sessionId, closed: 0, error: "session_not_found" });
      continue;
    }
    let closed = 0;
    let failed = false;
    for (const resource of resources) {
      if (resource.sessionId !== sessionId) continue;
      try {
        auth.access.requireProjectAccess(userId, projectId);
        if ((await close(resource.id, sessionId)) !== false) closed++;
      } catch {
        // A parallel close is already complete. A resource moved to another Session is never retried.
        failed ||= list().some(
          (current) => current.id === resource.id && current.sessionId === sessionId,
        );
      }
    }
    results.push({ sessionId, closed, ...(failed ? { error: "close_failed" } : {}) });
  }
  return { results };
}
