/**
 * The id a chat route's direct lookup asks for.
 *
 * A full id is asked for as it stands. An 8-hex short id (`/chat/2556a209`) names no Session by
 * itself, so it is resolved first — freshly, by asking every server of the Project what it can
 * answer for right now. Neither the sidebar's loaded page nor an organization snapshot takes
 * part: a cold start resolves exactly like a warm one, a Session another Project holds never
 * counts, and a suffix two readable Sessions share refuses to open instead of letting the
 * first answer win.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type { batchSessions, listAgents } from "../../../api/endpoints";
import { isShortSessionId, resolveShortSessionId } from "../session-project";

/**
 * The id to ask for, and the server to ask: `machineId` absent routes the id itself through
 * the id map, null is this server, a string is that machine.
 */
export interface RouteLookupId {
  sessionId: string;
  machineId?: string | null;
}

/** Rows per Agent per enumeration page: the batch endpoint's ceiling. */
export const SHORT_LOOKUP_PAGE_SIZE = 1000;

/** One server's full readable listing for the Project, freshly read. `null` is this server. */
export type SourceListing = (machineId: string | null) => Promise<readonly SessionInfo[]>;

/**
 * The lookup id the route names: the short id's one readable Session — with the server that
 * answered, so the row is read from it directly and the id map learns the pairing — or null
 * when the suffix resolves to nothing or to more than one. The caller asks the route id as it
 * stands in the null case, which no server answers for a short id: the 404 is the refusal.
 */
export async function resolveRouteLookupId(
  routeSessionId: string,
  machineIds: readonly string[],
  listing: SourceListing,
): Promise<RouteLookupId | null> {
  if (!isShortSessionId(routeSessionId)) return { sessionId: routeSessionId };
  let unique: RouteLookupId | null = null;
  // Every source is asked, this server first: a verdict of uniqueness spans them all, and the
  // same full id read twice (a Session this server mirrors) is one hit, not two.
  for (const machineId of [null, ...machineIds]) {
    const rows = await listing(machineId);
    const full = resolveShortSessionId(
      routeSessionId,
      rows.map((row) => row.sessionId),
    );
    if (full === null) continue;
    if (unique !== null && unique.sessionId.toLowerCase() !== full.toLowerCase()) return null;
    if (unique === null) unique = { sessionId: full, machineId };
  }
  return unique;
}

/**
 * The fresh listing one Project's servers answer with, built on the API's own readers: each
 * source is asked for the Agents it holds and then paged whole — no category filter, so an
 * organization's desk and ticket sessions are read with the rest, which is what makes them
 * resolvable on a cold start without any snapshot having loaded.
 */
export function createSourceListing(
  projectId: string,
  readers: {
    listAgents: typeof listAgents;
    batchSessions: typeof batchSessions;
  },
): SourceListing {
  return async (machineId) => {
    const { agents } = await readers.listAgents(projectId, machineId);
    const rows: SessionInfo[] = [];
    let offset = 0;
    for (;;) {
      const res = await readers.batchSessions(
        projectId,
        agents.map((agent) => ({ agentId: agent.agentId, limit: SHORT_LOOKUP_PAGE_SIZE, offset })),
        machineId,
      );
      let fullPage = false;
      for (const result of res.results) {
        if (!result.ok) continue;
        rows.push(...result.sessions);
        if (result.sessions.length >= SHORT_LOOKUP_PAGE_SIZE) fullPage = true;
      }
      if (!fullPage) return rows;
      offset += SHORT_LOOKUP_PAGE_SIZE;
    }
  };
}
