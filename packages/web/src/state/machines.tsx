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
import { apiErrorText } from "../lib/api-error";
import { useAuth } from "./auth";
import { useProject } from "./project";

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
  /** The last read's failure, in words; null when it answered. */
  error: string | null;
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
  const admin = useAuth().user?.isAdmin === true;
  const [state, setState] = useState<MachinesResponse | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The Project the current answers are about: a late one about another is dropped. */
  const current = useRef<string | null>(null);
  /** The read in flight and the Project it asks about, and whether another is owed after it. */
  const reading = useRef<{ projectId: string; done: Promise<void> } | null>(null);
  const owed = useRef(false);

  const refresh = useCallback((): Promise<void> => {
    if (projectId === null || !admin) return Promise.resolve();
    const inFlight = reading.current;
    if (inFlight !== null && inFlight.projectId === projectId) {
      owed.current = true;
      return inFlight.done;
    }
    const run = async () => {
      do {
        owed.current = false;
        try {
          const next = await api.getMachines(projectId);
          if (current.current !== projectId) return;
          setState(next);
          setError(null);
        } catch (err) {
          if (current.current !== projectId) return;
          setError(apiErrorText(err));
        } finally {
          if (current.current === projectId) setSettled(true);
        }
      } while (owed.current && current.current === projectId);
    };
    const done = run().finally(() => {
      if (reading.current?.done === done) reading.current = null;
    });
    reading.current = { projectId, done };
    return done;
  }, [projectId, admin]);

  useEffect(() => {
    current.current = projectId;
    setState(null);
    setError(null);
    // No Project yet is still waiting; a user who reads no machines has an account already.
    setSettled(projectId !== null && !admin);
    if (projectId === null || !admin) return;
    void refresh();
    return subscribeMachinesChanged(() => void refresh());
  }, [projectId, admin, refresh]);

  const accept = useCallback((next: MachinesResponse) => {
    setState(next);
    setError(null);
    setSettled(true);
  }, []);

  const value = useMemo<MachinesAccount>(
    () => ({ state, settled, error, refresh, accept }),
    [state, settled, error, refresh, accept],
  );
  return <MachinesContext.Provider value={value}>{children}</MachinesContext.Provider>;
}

/** The Project's machines, live (see the module doc). */
export function useMachines(): MachinesAccount {
  return useContext(MachinesContext);
}
