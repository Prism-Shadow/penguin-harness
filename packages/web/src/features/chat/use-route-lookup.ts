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
 * (a newer `listRound`); asking is started when the hub names them.
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
  /** Still being looked for. */
  pending: boolean;
  /** Looked for, and the servers that could answer are out of reach: the page says so. */
  outOfReach: boolean;
  reach: RouteReach;
  /** The machines out of reach, the hub's named ones included: for the page to name. */
  silent: readonly string[];
}

export function useRouteLookup<T>(input: RouteLookupInput<T>): RouteLookup {
  const { key } = input;
  const [probe] = useState(() => new RouteProbe());
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<string | null>(null);
  const [doubtKey, setDoubtKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [named, setNamed] = useState<{ key: string; ids: string[]; round: number } | null>(null);

  const hubSilent =
    named !== null && named.key === key && named.round === input.listRound ? named.ids : [];
  const silent = [...new Set([...input.offline, ...hubSilent])];
  const reach = routeReach({
    owner: input.owner,
    local: input.local,
    offline: silent,
    asking: input.asking,
  });
  const failed = key !== null && failedKey === key;
  const doubted = key !== null && doubtKey === key;
  const unowned = key !== null && !input.deletedHere && reach !== "answered";
  const pending =
    key !== null && routeLookupPending({ listed: input.listed, failed, unowned, doubted });
  const outOfReach = pending && failed && reach === "unanswered";

  // Read when a lookup settles, which is after the render that sent it.
  const latest = useRef(input);
  latest.current = input;
  const reachNow = useRef(reach);
  reachNow.current = reach;

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
        latest.current.onFound(row, listLoading);
      },
      gone: (cause) => {
        setFailedKey(key);
        const api = cause instanceof ApiError ? cause : null;
        if (api?.code === MACHINE_NO_ANSWER) {
          setNamed({ key, ids: silentMachinesOf(api.details), round: latest.current.listRound });
          latest.current.onMachinesSilent();
        }
        const verdict = lookupVerdict(
          { status: api?.status ?? null, code: api?.code ?? null },
          reachNow.current,
        );
        if (verdict === "missing") setMissingKey(key);
        setDoubtKey(verdict === "doubt" ? key : null);
      },
    });
  }, [probe, key, input.listLoading, input.listed, input.deletedHere, pending, attempt]);

  // A lookup that failed in doubt is made again once every server that could hold the Session
  // has answered; its answer, found or not, is the verdict.
  useEffect(() => {
    if (key === null || doubtKey !== key || reach !== "answered") return;
    setAttempt((n) => n + 1);
  }, [key, doubtKey, reach]);

  return {
    failed,
    missing: key !== null && missingKey === key,
    pending,
    outOfReach,
    reach,
    silent,
  };
}
