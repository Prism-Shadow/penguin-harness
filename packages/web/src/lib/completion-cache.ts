/**
 * The command palette's session-completion cache: what the app has seen of each Agent's
 * sessions, remembered per (project, source, agent) for the app's whole run with no expiry.
 *
 * So the next prefix that shares a head with one already asked (which every typed prefix
 * does) offers the remembered sessions at once, and only the tail of the id is still on the
 * network: the sidebar's fetches write theirs in as they land, and the completion's own live
 * answers write themselves too.
 *
 * Module state rather than React state: it is a completion cache, not render state — no
 * component renders it directly, the rows reach the screen only through the answer each
 * keystroke builds from it. Rows are never evicted: one agent's entry holds at most the cap
 * (a day of use stays a few thousand rows at most), and every read still asks the servers
 * live, so nothing remembered outlives the next answer.
 *
 * Rows are filtered to the prefix when read, not when written: an agent's remembered rows are
 * what it has been SEEN holding for every prefix so far, and one search per read is all the
 * trimming the merge needs.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";

/** How many rows one agent's entry holds — the palette is a picker, not a list page. */
export const COMPLETION_CACHE_MAX = 20;

const cache = new Map<string, SessionInfo[]>();

const keyFor = (projectId: string, machineId: string | null, agentId: string) =>
  `${projectId}:${machineId ?? "-"}:${agentId}`;

/** The rows in the activity order the sidebar pages by: most recently active first, ties by id. */
function mostRecentFirst(sessions: readonly SessionInfo[]): SessionInfo[] {
  return [...sessions].sort(
    (a, b) =>
      b.lastActiveAt.localeCompare(a.lastActiveAt) || b.sessionId.localeCompare(a.sessionId),
  );
}

/**
 * Merges rows into what one (project, source, agent) is remembered as having seen: an id
 * already remembered stays unless the new row's activity is newer. The sidebar's pages and a
 * live query's answers both come in through here — neither is the agent's whole list, so
 * neither may erase what a previous answer put there; every read still asks the servers live,
 * so a Session deleted since is completed only until that answer lands.
 */
export function rememberCompletionRows(
  projectId: string,
  machineId: string | null,
  agentId: string,
  rows: readonly SessionInfo[],
): void {
  const key = keyFor(projectId, machineId, agentId);
  const byId = new Map(cache.get(key)?.map((s) => [s.sessionId, s]));
  for (const s of rows) {
    const known = byId.get(s.sessionId);
    if (known === undefined || known.lastActiveAt < s.lastActiveAt) byId.set(s.sessionId, s);
  }
  const merged = mostRecentFirst([...byId.values()]).slice(0, COMPLETION_CACHE_MAX);
  if (merged.length === 0) cache.delete(key);
  else cache.set(key, merged);
}

/** What one (project, source, agent) is remembered as having seen; empty when nothing is. */
export function cachedCompletionRows(
  projectId: string,
  machineId: string | null,
  agentId: string,
): readonly SessionInfo[] {
  return cache.get(keyFor(projectId, machineId, agentId)) ?? [];
}

/** Forgets the whole completion cache. Tests start from nothing; nothing else calls this. */
export function resetCompletionCache(): void {
  cache.clear();
}
