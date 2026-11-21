/**
 * One read per machine of the Project, for a page that lists every machine's entries beside this
 * server's (the App Center's apps): each machine is asked through this server's proxy, and its
 * answer shows the moment it lands, whatever the others are doing.
 *
 * Only an administrator reads machines (the machines list and the proxy refuse anyone else), so
 * for anyone else this lists nothing. The machines are the Project's installed ones as the one
 * live account of them has them (state/machines.tsx), so a machine joins or leaves the moment the
 * Machines page sees it do so.
 *
 * Answers live in a catalog store (lib/catalog-storage.ts) under a key naming the Project, the
 * account and the machine, so every reader shares one request and a reload comes back to what
 * each machine last showed. A connected machine is asked when a page mounts (unless it answered
 * in the last minute) and when it connects again — a reconnect marks its answer stale, since the
 * machine may have changed while it was out of reach — and a machine out of reach keeps its last
 * answer, not live. A machine that refuses the read, or leaves the Project's list, takes its
 * answer with it.
 */
import { useEffect, useRef } from "react";
import { useAuth } from "../state/auth";
import { useMachines } from "../state/machines";
import { catalogKey, catalogScope } from "./catalog-storage";
import { agentMachines, type AgentMachineInfo } from "./machine-agent-lists";
import { useReads, type ReadStore } from "./read-store";

/** A machine's answer once asked: what it last answered, and whether that is its word right now. */
export interface MachineCatalog<T> {
  machine: AgentMachineInfo;
  /** The last answer, from this tab or from its storage; null when nothing is known. */
  value: T | null;
  /** The machine is connected and answered in this page load, and its last read did not fail. */
  live: boolean;
  /** The last read's failure in words; null when it answered. */
  error: string | null;
  /** Asks the machine again (readers on screen read at once). */
  refresh: () => void;
}

/** How long an answer stands before a page that mounts asks again (ms). */
const FRESH_MS = 60_000;

export function useMachineCatalogs<T>(
  store: ReadStore<T>,
  projectId: string | null,
  load: (projectId: string, machineId: string) => Promise<T>,
): MachineCatalog<T>[] {
  const { user } = useAuth();
  const { state, settled } = useMachines();
  const scope = user?.isAdmin && projectId ? catalogScope(projectId, user.userId) : null;
  const machines = scope ? agentMachines(state, settled) : [];
  const keys = machines.map((m) => catalogKey(scope!, m.machineId));
  const requests = machines.map((m, i) => ({
    key: keys[i]!,
    enabled: m.link === "connected",
    run: () => load(projectId!, m.machineId),
  }));

  // A machine that connects again is asked again, however recently it last answered.
  const previous = useRef<{ scope: string | null; links: Map<string, boolean> }>({
    scope: null,
    links: new Map(),
  });
  const links = JSON.stringify(machines.map((m, i) => [keys[i], m.link === "connected"]));
  useEffect(() => {
    if (!settled || !state || !scope) return;
    const current = new Map<string, boolean>(JSON.parse(links) as [string, boolean][]);
    const last = previous.current;
    if (last.scope === scope) {
      for (const [key, connected] of last.links) {
        if (!connected && current.get(key)) store.invalidate(key);
      }
    }
    previous.current = { scope, links: current };
  }, [store, scope, links, settled, state]);

  const reads = useReads(store, requests, { minAgeMs: FRESH_MS });
  return machines.map((machine, i) => ({
    machine,
    value: reads[i]!.value,
    error: reads[i]!.error,
    // A re-read under way keeps an answer of this page load live: nothing on screen flickers.
    live: machine.link === "connected" && reads[i]!.fresh && !reads[i]!.error,
    refresh: () => store.invalidate(keys[i]!),
  }));
}
