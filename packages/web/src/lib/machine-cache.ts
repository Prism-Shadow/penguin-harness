/**
 * What each machine was last seen holding, kept across a restart.
 *
 * A machine can only be asked over a live forward, and a forward does not survive a restart.
 * So for the seconds between the page coming up and that machine answering again, everything
 * built only from what answers RIGHT NOW is this server's answer alone: its Sessions in the
 * list, and — for a workspace that lives over there — no Agents at all to start one with.
 * The remote half of someone's work is simply not there, which reads as lost rather than as
 * pending.
 *
 * So the last answer each machine gave is written down, and shown while that machine is out
 * of reach. It is replaced wholesale the moment the machine answers again — never merged,
 * because something the machine no longer has would then outlive it.
 *
 * Per machine rather than per list: this server's own answers are always available and never
 * need caching, and a machine that answers must replace ITS entries without touching a
 * neighbour's.
 *
 * Storage is best-effort in both directions. Every browser can refuse it (private windows,
 * cleared site data, storage disabled), and reading back something that no longer parses is
 * the same as having nothing — in every one of those cases the page degrades to exactly what
 * it did before there was a cache.
 */
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";

const SESSIONS_PREFIX = "penguin.machineSessions.";
const AGENTS_PREFIX = "penguin.machineAgents.";

/**
 * Rows kept per machine. Comfortably more than the sidebar's first page, and far short of
 * what would make the write worth worrying about — this is a placeholder for a list that is
 * about to be refetched, not a copy of the machine's history.
 */
export const CACHED_ROWS_PER_MACHINE = 200;

const keyFor = (prefix: string, projectId: string, machineId: string) =>
  `${prefix}${projectId}:${machineId}`;

/** Replaces one entry. An empty list clears it, which is how something deleted stops returning. */
function remember(prefix: string, projectId: string, machineId: string, items: unknown[]): void {
  try {
    const key = keyFor(prefix, projectId, machineId);
    if (items.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(items.slice(0, CACHED_ROWS_PER_MACHINE)));
  } catch {
    // Storage refused or is full: the answer is merely not remembered across the next restart.
  }
}

/**
 * One entry, keeping only what `hasId` recognises — a value written by an older version, or
 * hand-edited, may hold something that can be neither rendered nor addressed.
 */
function cached<T>(
  prefix: string,
  projectId: string,
  machineId: string,
  hasId: (row: object) => boolean,
): T[] {
  try {
    const raw = localStorage.getItem(keyFor(prefix, projectId, machineId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is T => typeof row === "object" && row !== null && hasId(row));
  } catch {
    return [];
  }
}

/** Replaces the Sessions this machine is remembered as holding. */
export function rememberMachineSessions(
  projectId: string,
  machineId: string,
  sessions: readonly SessionInfo[],
): void {
  remember(SESSIONS_PREFIX, projectId, machineId, [...sessions]);
}

/** The Sessions this machine was last seen holding. Empty when nothing is remembered. */
export function cachedMachineSessions(projectId: string, machineId: string): SessionInfo[] {
  return cached<SessionInfo>(
    SESSIONS_PREFIX,
    projectId,
    machineId,
    (row) => typeof (row as SessionInfo).sessionId === "string",
  );
}

/**
 * Replaces the Agents this machine is remembered as running.
 *
 * Agents are per server, not per Project: a machine has its own set, and the composer offers
 * THAT set when the chosen workspace lives over there. Until the machine answers there is
 * nothing to pick, so a draft on a remote workspace could not be started at all.
 */
export function rememberMachineAgents(
  projectId: string,
  machineId: string,
  agents: readonly AgentSummary[],
): void {
  remember(AGENTS_PREFIX, projectId, machineId, [...agents]);
}

/** The Agents this machine was last seen running. Empty when nothing is remembered. */
export function cachedMachineAgents(projectId: string, machineId: string): AgentSummary[] {
  return cached<AgentSummary>(
    AGENTS_PREFIX,
    projectId,
    machineId,
    (row) => typeof (row as AgentSummary).agentId === "string",
  );
}
