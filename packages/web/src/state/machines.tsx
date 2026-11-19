/**
 * The Project's machines, as ONE live account every surface reads: the Machines page, the
 * new-chat composer (the Agents of the machine its workspace is on), the workspace picker, and
 * the session list and terminals (which machines to ask).
 *
 * Each of those used to keep a reading of its own — the page polled, the session list fetched
 * once and looked again only while something was offline, the composer asked the machine once
 * when its workspace was picked — and the readings disagreed: a composer that asked while a
 * machine was still connecting kept saying "not connected" long after the page showed it
 * connected, because nothing ever told it otherwise.
 *
 * Now the server says when the list changed (`machines_changed` on the user event stream, which
 * state/sessions.tsx forwards through `publishMachinesChanged`), and this provider reads it again:
 * every surface sees the same machines at the same moment, and a job's steps arrive as they
 * happen rather than between polls. Reads are coalesced — one in flight, at most one more after
 * it, so a burst of changes costs two reads — and an answer about a Project the user has since
 * left is dropped.
 *
 * Machines are an admin's: anyone else has nothing to read, which is not a failure — `settled`
 * says the account is complete either way, and is what a surface waits for before it decides that
 * no machine is reachable.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import {
  catalogAccessDenied,
  catalogKey,
  catalogScope,
  forgetCatalogs,
  inCatalogScope,
} from "../lib/catalog-storage";
import { useAuth } from "./auth";
import { useProject } from "./project";
import { failureNode } from "../lib/failure";

const changeListeners = new Set<() => void>();

/** The server said the machines list changed: every mounted provider reads it again. */
export function publishMachinesChanged(): void {
  for (const listener of changeListeners) listener();
}

/** Hears every `publishMachinesChanged`; the returned function stops it. */
export function subscribeMachinesChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export interface MachinesAccount {
  /** The list as last read; null before the first answer, and for a user with no machines to read. */
  state: MachinesResponse | null;
  /** The first read has answered — or there is none to make for this user. */
  settled: boolean;
  /** The last read's failure, in words and with its report for a failure; null when it answered. */
  error: ReactNode;
  /** Reads the list again now. */
  refresh: () => Promise<void>;
  /** Takes an answer a request already brought: every machines POST answers with the list. */
  accept: (next: MachinesResponse) => void;
}

const NONE: MachinesAccount = {
  state: null,
  settled: false,
  error: null,
  refresh: async () => {},
  accept: () => {},
};

const MachinesContext = createContext<MachinesAccount>(NONE);

export function MachinesProvider({ children }: { children: ReactNode }) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const { user } = useAuth();
  const admin = user?.isAdmin === true;
  /** The Project and the account the list is read for: another account's answer is not shown. */
  const scope = admin && projectId !== null ? catalogScope(projectId, user.userId) : null;
  const [state, setState] = useState<MachinesResponse | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  /** The scope the current answers are about: a late one about another is dropped. */
  const current = useRef<string | null>(null);
  /** The read in flight and the scope it asks about, and whether another is owed after it. */
  const reading = useRef<{ scope: string; done: Promise<void> } | null>(null);
  const owed = useRef(false);

  const adopt = useCallback(
    (next: MachinesResponse | null) => {
      if (!scope || current.current !== scope) return;
      // A machine the Project no longer lists takes what it answered with it.
      const allowed = new Set(
        next?.machines
          .filter((m) => !m.local && m.installed && m.machineId)
          .map((m) => catalogKey(scope, m.machineId!)),
      );
      forgetCatalogs((key) => inCatalogScope(key, scope) && !allowed.has(key));
      setState(next);
    },
    [scope],
  );

  const refresh = useCallback((): Promise<void> => {
    if (projectId === null || scope === null) return Promise.resolve();
    const inFlight = reading.current;
    if (inFlight !== null && inFlight.scope === scope) {
      owed.current = true;
      return inFlight.done;
    }
    const run = async () => {
      do {
        owed.current = false;
        try {
          const next = await api.getMachines(projectId);
          if (current.current !== scope) return;
          adopt(next);
          setError(null);
        } catch (err) {
          if (current.current !== scope) return;
          if (catalogAccessDenied(err)) adopt(null);
          setError(
            failureNode(err, { what: "the machines could not be read", mask: { hosts: true } }),
          );
        } finally {
          if (current.current === scope) setSettled(true);
        }
      } while (owed.current && current.current === scope);
    };
    const done = run().finally(() => {
      if (reading.current?.done === done) reading.current = null;
    });
    reading.current = { scope, done };
    return done;
  }, [projectId, scope, adopt]);

  useEffect(() => {
    current.current = scope;
    setState(null);
    setError(null);
    // No Project yet is still waiting; a user who reads no machines has an account already.
    setSettled(projectId !== null && !admin);
    if (projectId === null || !admin) return;
    void refresh();
    return subscribeMachinesChanged(() => void refresh());
  }, [projectId, admin, scope, refresh]);

  const accept = useCallback(
    (next: MachinesResponse) => {
      if (!scope || current.current !== scope) return;
      adopt(next);
      setError(null);
      setSettled(true);
    },
    [scope, adopt],
  );

  const visible = scope !== null && current.current === scope;
  const value = useMemo<MachinesAccount>(
    () => ({
      state: visible ? state : null,
      settled: visible ? settled : projectId !== null && !admin,
      error: visible ? error : null,
      refresh,
      accept,
    }),
    [visible, projectId, admin, state, settled, error, refresh, accept],
  );
  return <MachinesContext.Provider value={value}>{children}</MachinesContext.Provider>;
}

/** The Project's machines, live (see the module doc). */
export function useMachines(): MachinesAccount {
  return useContext(MachinesContext);
}
