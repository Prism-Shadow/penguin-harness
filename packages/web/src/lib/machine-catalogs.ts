// Project membership and the signed-in administrator's machine list gate every cached read.
import { useEffect, useRef } from "react";
import { useAuth } from "../state/auth";
import { useMachines } from "../state/machines";
import { agentMachines, type AgentMachineInfo } from "./machine-agent-lists";
import { readKey, useReads, type ReadStore } from "./read-store";

export interface MachineCatalog<T> {
  machine: AgentMachineInfo;
  value: T | null;
  live: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMachineCatalogs<T>(
  store: ReadStore<T>,
  projectId: string | null,
  load: (projectId: string, machineId: string) => Promise<T>,
): MachineCatalog<T>[] {
  const { user } = useAuth();
  const { state, settled } = useMachines();
  const scope = user?.isAdmin && projectId ? readKey(projectId, user.userId) : null;
  const machines = scope ? agentMachines(state, settled) : [];
  const previous = useRef<{ scope: string | null; links: Map<string, boolean> }>({
    scope: null,
    links: new Map(),
  });
  const keys = machines.map((m) => readKey(scope!, m.machineId));
  const requests = machines.map((m, i) => ({
    key: keys[i]!,
    enabled: m.link === "connected",
    run: () => load(projectId!, m.machineId),
  }));
  const links = JSON.stringify(machines.map((m, i) => [keys[i], m.link === "connected"]));
  useEffect(() => {
    if (!settled || !state || !scope) return;
    const current = new Map<string, boolean>(JSON.parse(links));
    const last = previous.current;
    if (last.scope === scope) {
      for (const [key, connected] of last.links) {
        if (!connected && current.get(key)) store.invalidate(key);
      }
    }
    previous.current = { scope, links: current };
  }, [store, scope, links, settled, state]);
  const reads = useReads(store, requests, { minAgeMs: 60_000 });
  return machines.map((machine, i) => ({
    machine,
    value: reads[i]!.value,
    error: reads[i]!.error,
    live: machine.link === "connected" && reads[i]!.fresh && !reads[i]!.stale && !reads[i]!.error,
    refresh: () => store.invalidate(keys[i]!),
  }));
}
