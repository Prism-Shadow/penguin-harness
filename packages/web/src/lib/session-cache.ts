/**
 * The Sessions each machine was last seen holding, kept across a restart.
 *
 * A machine's Sessions can only be listed over a live forward, and a forward does not
 * survive a restart — so for the seconds between the page coming up and that machine
 * answering again, a list built only from what answers RIGHT NOW is this server's Sessions
 * alone. The remote half of someone's work simply is not there, which reads as lost rather
 * than as pending.
 *
 * So the last answer each machine gave is written down, and shown while that machine is out
 * of reach. It is replaced wholesale the moment the machine answers again — the cache is
 * never merged with a live answer, because a row the machine no longer has would then
 * outlive it. Only what the sidebar actually fetched is kept (the first page of the active
 * stream, plus whatever pages were open), which is what the sidebar would show anyway.
 *
 * Per machine rather than per list: this server's own Sessions are always available and
 * never need caching, and a machine that answers must replace ITS rows without touching a
 * neighbour's.
 *
 * Storage is best-effort in both directions. Every browser can refuse it (private windows,
 * cleared site data, storage disabled), and reading back rows that no longer parse is the
 * same as having none — in every one of those cases the list degrades to exactly what it did
 * before there was a cache.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";

const PREFIX = "penguin.machineSessions.";

/**
 * Rows kept per machine. Comfortably more than the sidebar's first page, and far short of
 * what would make the write worth worrying about — this is a placeholder for a list that is
 * about to be refetched, not a copy of the machine's history.
 */
export const CACHED_ROWS_PER_MACHINE = 200;

const keyFor = (projectId: string, machineId: string) => `${PREFIX}${projectId}:${machineId}`;

/** Replaces what this machine is remembered as holding. An empty list clears the entry. */
export function rememberMachineSessions(
  projectId: string,
  machineId: string,
  sessions: readonly SessionInfo[],
): void {
  try {
    const key = keyFor(projectId, machineId);
    if (sessions.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(sessions.slice(0, CACHED_ROWS_PER_MACHINE)));
  } catch {
    // Storage refused or is full: the list is merely not remembered across the next restart.
  }
}

/** What this machine was last seen holding. Empty when nothing is remembered. */
export function cachedMachineSessions(projectId: string, machineId: string): SessionInfo[] {
  try {
    const raw = localStorage.getItem(keyFor(projectId, machineId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Written by an older version, or hand-edited: anything without an id cannot be rendered
    // as a row or routed as a Session, so it is dropped rather than trusted.
    return parsed.filter(
      (row): row is SessionInfo =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as SessionInfo).sessionId === "string",
    );
  } catch {
    return [];
  }
}
