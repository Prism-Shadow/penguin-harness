/**
 * The chat page's direct lookup of the routed Session when the list does not hold it, and what it
 * settles (route-reach.ts for the rules, route-probe.ts for one lookup in flight at a time).
 *
 * The lookup runs while the Session is still being looked for. A failure settles it only when it
 * is a verdict: a 404 with every server that could hold the Session answering, or for a Session
 * known to be on this server. A failure in doubt — the hub's `machine_no_answer`, or a 404 while
 * a machine that could hold it was silent — keeps it looked for, says which machines are out of
 * reach, and is made again once they have answered: the attempt count is in the lookup's own
 * dependencies, so it runs again even though nothing else about the page changed.
 *
 * The machines the hub named as silent count as out of reach until the list has asked them again
 * (a newer `listRound`); asking is started when the hub names them, for the first few doubts
 * only. The page keeps naming them until a lookup settles with another answer: the list hearing
 * a machine the hub does not is no news about the Session. A socket that gave up on the routed
 * machine names nobody: the Session's own machine stands in when it is on record. Which of the
 * named machines are not connected, as against connected and not answering, is the list's
 * account of the connections (`disconnected`).
 *
 * Asking again backs off like the streams' retries (1 s, doubling, at most 30 s), so a hub that
 * keeps not hearing a machine the list hears is not asked in a loop. Once a lookup has failed in
 * doubt, the page keeps saying so — through list rounds that ask other machines, and while the
 * lookup is made again — until the set of silent machines changes or the Session resolves.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { RouteProbe } from "./route-probe";
import {
  MACHINE_NO_ANSWER,
  lookupVerdict,
  routeLookupPending,
  routeReach,
  silentMachinesOf,
} from "./route-reach";
import type { RouteReach } from "./route-reach";

export interface RouteLookupInput<T> {
  /** The routed Session's lookup key (Project and Session); null when nothing is to be looked up. */
  key: string | null;
  /** The Session list's first load is still running: a failure then is no verdict. */
  listLoading: boolean;
  /** The list (or an earlier lookup) holds the routed Session. */
  listed: boolean;
  /** This page deleted the Session: its lookup fails at once, and that settles it. */
  deletedHere: boolean;
  /** The machine the Session is on record as living on, or null. */
  owner: string | null;
  /** The Session is known to be on this server. */
  local: boolean;
  /** Machines out of reach, and machines the list is still asking. */
  offline: readonly string[];
  asking: readonly string[];
  /** The machines no connection is held to; any other machine out of reach did not answer. */
  disconnected: readonly string[];
  /** The list's completed rounds (state/sessions.tsx `listRound`). */
  listRound: number;
  /** One lookup: the row, or null when the answer is not one the page may show. */
  lookup: () => Promise<T | null>;
  onFound: (row: T, listLoading: boolean) => void;
  /** The hub named machines it could not ask: the list asks them again. */
  onMachinesSilent: () => void;
}

export interface RouteLookup {
  /** A lookup has failed for the routed Session. */
  failed: boolean;
  /** The verdict: the Session does not exist. */
  missing: boolean;
  /**
   * The verdict: the machine holding the Session will not show it to this server (403
   * `session_forbidden`) — the machine, as the answer names it; null otherwise.
   */
  refused: { machineId: string | null; alias: string | null } | null;
  /** Still being looked for. */
  pending: boolean;
  /** Looked for, and the servers that could answer are out of reach: the page says so. */
  outOfReach: boolean;
  reach: RouteReach;
  /**
   * The machines out of reach, for the page to name: the hub's named ones included until a
   * lookup answers otherwise.
   */
  silent: readonly string[];
  /** Among `silent`, the machines not connected; the others are connected and did not answer. */
  disconnected: readonly string[];
}

/** The wait before a doubted lookup is made again: 1 s, doubling per doubt, at most 30 s. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Doubts that ask the list to read the named machines again; past them, its own rounds do. */
const RELOADS = 3;

export function useRouteLookup<T>(input: RouteLookupInput<T>): RouteLookup {
  const { key } = input;
  const [probe] = useState(() => new RouteProbe());
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<string | null>(null);
  const [doubtKey, setDoubtKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [named, setNamed] = useState<{ key: string; ids: string[]; round: number } | null>(null);
  /** Doubts in a row for `key`: the backoff's exponent and the reload budget. */
  const [doubts, setDoubts] = useState<{ key: string; count: number } | null>(null);
  const [refusal, setRefusal] = useState<{
    key: string;
    machineId: string | null;
    alias: string | null;
  } | null>(null);

  const namedHere = named !== null && named.key === key ? named.ids : [];
  // For whether every server that could hold the Session has answered, the hub's word stands
  // until the list has asked those machines again; for the words, until a lookup says otherwise.
  const hubSilent = named !== null && named.round === input.listRound ? namedHere : [];
  const silent = [...new Set([...input.offline, ...namedHere])];
  const disconnected = silent.filter((id) => input.disconnected.includes(id));
  const reach = routeReach({
    owner: input.owner,
    local: input.local,
    offline: [...new Set([...input.offline, ...hubSilent])],
    asking: input.asking,
  });
  const failed = key !== null && failedKey === key;
  const doubted = key !== null && doubtKey === key;
  const refused = key !== null && refusal !== null && refusal.key === key && !input.listed;
  const unowned = key !== null && !input.deletedHere && reach !== "answered";
  // A refusal is an answer from the machine that holds the Session: nothing is pending on it.
  const pending =
    key !== null &&
    !refused &&
    routeLookupPending({ listed: input.listed, failed, unowned, doubted });
  // A lookup that failed in doubt keeps saying so until it resolves: a list round asking other
  // machines, or the wait before it is made again, is no news to the reader.
  const outOfReach = pending && failed && (reach === "unanswered" || doubted);
  const doubtCount = doubts !== null && doubts.key === key ? doubts.count : 0;

  // Read when a lookup settles, which is after the render that sent it.
  const latest = useRef(input);
  latest.current = input;
  const reachNow = useRef(reach);
  reachNow.current = reach;
  const doubtsNow = useRef(doubts);
  doubtsNow.current = doubts;

  useEffect(() => {
    probe.track(key, input.listLoading);
    if (key === null || !pending) return;
    if (input.deletedHere) {
      setFailedKey(key);
      return;
    }
    probe.run(key, () => latest.current.lookup(), {
      found: (row, listLoading) => {
        setDoubtKey(null);
        setDoubts(null);
        setNamed(null);
        latest.current.onFound(row, listLoading);
      },
      gone: (cause) => {
        setFailedKey(key);
        const api = cause instanceof ApiError ? cause : null;
        const verdict = lookupVerdict(
          { status: api?.status ?? null, code: api?.code ?? null },
          reachNow.current,
        );
        if (verdict === "missing") setMissingKey(key);
        if (verdict === "refused") {
          setRefusal({
            key,
            machineId: api?.details?.machineId ?? null,
            alias: api?.details?.alias ?? null,
          });
        }
        setDoubtKey(verdict === "doubt" ? key : null);
        // Another answer than the hub's naming: the machines it named are no longer the news.
        if (api?.code !== MACHINE_NO_ANSWER) setNamed(null);
        if (verdict !== "doubt") {
          setDoubts(null);
          return;
        }
        const count = (doubtsNow.current?.key === key ? doubtsNow.current.count : 0) + 1;
        setDoubts({ key, count });
        if (api?.code === MACHINE_NO_ANSWER) {
          // The hub names the machines it could not ask; a socket that gave up on the routed
          // machine names nobody, and the Session's own machine, when on record, is the one.
          const owner = latest.current.owner;
          const ids = silentMachinesOf(api.details);
          setNamed({
            key,
            ids: ids.length > 0 ? ids : owner !== null ? [owner] : [],
            round: latest.current.listRound,
          });
          if (count <= RELOADS) latest.current.onMachinesSilent();
        }
      },
    });
  }, [probe, key, input.listLoading, input.listed, input.deletedHere, pending, attempt]);

  // A lookup that failed in doubt is made again once every server that could hold the Session
  // has answered, after the backoff; its answer, found or not, is the verdict.
  useEffect(() => {
    if (key === null || doubtKey !== key || reach !== "answered") return;
    const wait = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, doubtCount - 1));
    const timer = setTimeout(() => setAttempt((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [key, doubtKey, reach, doubtCount]);

  return {
    failed,
    missing: key !== null && missingKey === key,
    refused: refused ? { machineId: refusal!.machineId, alias: refusal!.alias } : null,
    pending,
    outOfReach,
    reach,
    silent,
    disconnected,
  };
}
