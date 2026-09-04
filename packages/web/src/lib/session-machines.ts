/**
 * Which machine owns a Session.
 *
 * A Session lives on the server whose filesystem its workspace is on: that server runs the
 * agent, holds the messages, writes the trace, serves the files. So every call about a
 * Session has to reach THAT machine — and there are two dozen such endpoints.
 *
 * Rather than thread a machine argument through all of them, the routing is a rule over the
 * PATH: a request to `/api/sessions/<id>/…` goes wherever `<id>` was last seen. Call sites
 * stay unchanged, and a Session's machine is recorded in exactly two places — when a list
 * hands one back, and when one is created.
 *
 * Absence means this machine, which is also every Session that existed before Sessions could
 * live anywhere else. In-memory on purpose: the mapping is rebuilt by the very list that
 * displays them, and a stale entry surviving a reload would route a call at a machine that
 * may no longer own — or may no longer have — that Session.
 */

/** sessionId → the machine it lives on. Absent = this server. */
const owners = new Map<string, string>();

/** Records where a Session lives. `null` (this machine) is stored as absence, not as a value. */
export function rememberSessionMachine(sessionId: string, machineId: string | null): void {
  if (machineId === null) owners.delete(sessionId);
  else owners.set(sessionId, machineId);
}

/** The machine a Session lives on, or null for this one. */
export function machineForSession(sessionId: string): string | null {
  return owners.get(sessionId) ?? null;
}

/** Forgets everything — for a project switch, where the whole list is about to be rebuilt. */
export function forgetSessionMachines(): void {
  owners.clear();
}

/**
 * The session id a path is about, or null when it is not a session-scoped path.
 *
 * Deliberately narrow: only `/api/sessions/<id>` and paths beneath it. The project-scoped
 * `/api/projects/:p/agents/:a/sessions` listing is NOT session-scoped — it asks a server
 * which Sessions it has, and answering it from another machine would be that machine
 * answering a question about this one.
 */
export function sessionIdInPath(path: string): string | null {
  const match = /^\/api\/sessions\/([^/?#]+)/.exec(path);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!; // A malformed escape is not a reason to lose the id.
  }
}

/**
 * The machine a request should go to, from its path alone: the owner of the Session it names,
 * or null for this one. This is the whole routing rule.
 */
export function machineForPath(path: string): string | null {
  const sessionId = sessionIdInPath(path);
  return sessionId === null ? null : machineForSession(sessionId);
}
