/**
 * The Agents of each machine, as the Agents page, the plugin market and the session list read them.
 *
 * A machine's Agents are that machine's own (lib/agent-location.ts): each machine contributes its
 * own list, kept apart from this server's and from every other machine's, even where ids repeat.
 * The machines are the Project's installed ones, read from the one live account of the machines
 * (state/machines.tsx), so a list follows a machine the moment the Machines page sees it change.
 *
 * Every machine's list lives in ONE read store (lib/read-store.ts, `agentLists`), keyed by the
 * Project and the machine, and remembered across reloads (lib/machine-cache.ts): every reader of
 * a machine shares one request, and a page comes back to the list it last showed rather than to a
 * placeholder. A connected machine is asked when a page mounts (unless it answered moments ago),
 * when it connects, and after a write there; nothing polls. A machine that is not connected, or
 * that failed to answer, contributes what it was last seen holding, marked as not live and with
 * the reason in the words the composer uses: a list that silently dropped a machine's Agents
 * would read as Agents lost rather than as a machine out of reach.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentSummary, MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { cachedMachineAgents, rememberMachineAgents } from "./machine-cache";
import { machineLink, remoteAgentsEmpty } from "./machine-link";
import type { MachineLink } from "./machine-link";
import { createReadStore, readKey, useRead, useReads } from "./read-store";
import type { ReadState, ReadStorage, ReadStore } from "./read-store";
import { useMachines } from "../state/machines";
import { useProject } from "../state/project";

/** The Project and machine each list key is about, as {@link agentListKey} made it. */
const keyOwners = new Map<string, { projectId: string; machineId: string }>();

/** The key of one machine's Agent list in a Project. */
function agentListKey(projectId: string, machineId: string): string {
  const key = readKey(projectId, machineId, "agents");
  if (!keyOwners.has(key)) keyOwners.set(key, { projectId, machineId });
  return key;
}

/** The lists' storage: what each machine was last seen running (lib/machine-cache.ts). */
const listStorage: ReadStorage<AgentSummary[]> = {
  load: (key) => {
    const owner = keyOwners.get(key);
    if (owner === undefined) return null;
    const remembered = cachedMachineAgents(owner.projectId, owner.machineId);
    // An empty list is never written down (it clears the entry): nothing remembered.
    return remembered.length === 0 ? null : remembered;
  },
  save: (key, agents) => {
    const owner = keyOwners.get(key);
    if (owner !== undefined) rememberMachineAgents(owner.projectId, owner.machineId, agents);
  },
  clear: (key) => {
    const owner = keyOwners.get(key);
    if (owner !== undefined) rememberMachineAgents(owner.projectId, owner.machineId, []);
  },
};

/** Every machine's Agent list, per Project — this server's stays in state/project.tsx. */
export const agentLists: ReadStore<AgentSummary[]> = createReadStore({ storage: listStorage });

/** Asks the machine for its Agents. */
const fetchMachineAgents = (projectId: string, machineId: string) =>
  api.listAgents(projectId, machineId).then((res) => res.agents);

const changeListeners = new Set<(machineId: string) => void>();

/**
 * A machine's Agents changed under the page — one was created or deleted there, or a plugin
 * install moved its counts: its list is marked stale in every Project it was read for, so every
 * reader of it asks again — one request between them — the session list included (it lists a
 * Session of a machine's Agent only while that machine names the Agent).
 */
export function publishMachineAgentsChanged(machineId: string): void {
  // A copy: an invalidation tells readers at once, and one may name a key of its own meanwhile.
  for (const [key, owner] of [...keyOwners]) {
    if (owner.machineId === machineId) agentLists.invalidate(key);
  }
  for (const listener of [...changeListeners]) listener(machineId);
}

/** Hears every {@link publishMachineAgentsChanged}; the returned function stops it. */
export function subscribeMachineAgentsChanged(listener: (machineId: string) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** A machine whose Agents a page lists. */
export interface AgentMachineInfo {
  /** The machine's own id: what its proxy and every remembered list are keyed by. */
  machineId: string;
  /** Its ssh alias — the SSH address the page writes after an Agent's name. */
  label: string;
  /** Whether it can be asked anything right now, and if not, why. */
  link: MachineLink;
  /** The port its server listens on over there, when the last probe saw it running. */
  port: number | null;
}

/**
 * The Project's installed machines that have an id, this server left out, in name order (the
 * Machines page's order). A machine with nothing installed, or none minted yet, has no Agents
 * to list.
 */
export function agentMachines(
  state: MachinesResponse | null,
  settled: boolean,
): AgentMachineInfo[] {
  if (state === null) return [];
  const out: AgentMachineInfo[] = [];
  for (const machine of state.machines) {
    if (machine.local || machine.installed === null || machine.machineId === null) continue;
    out.push({
      machineId: machine.machineId,
      label: machine.alias,
      link: machineLink(state, settled, machine.machineId),
      port: machine.status?.port ?? null,
    });
  }
  return out.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** One machine as an Agent page reads it; null for this server, and for an id the list does not name. */
export function useMachineInfo(machineId: string | null): AgentMachineInfo | null {
  const machines = useMachines();
  return useMemo(
    () =>
      machineId === null
        ? null
        : (agentMachines(machines.state, machines.settled).find((m) => m.machineId === machineId) ??
          null),
    [machineId, machines.state, machines.settled],
  );
}

/** One machine's Agents, as a page shows them. */
export interface MachineAgents {
  machine: AgentMachineInfo;
  /** What the machine last answered, in this page load or before it; empty when nothing is known. */
  agents: AgentSummary[];
  /**
   * The machine is connected and answered in this page load, and its last read did not fail: its
   * Agents can be acted on. Survives navigation — a page left and re-entered is live at once.
   */
  live: boolean;
  /**
   * Not live: the link's reason (remoteAgentsEmpty), or the machine's own failure once connected;
   * null while a connected machine's first answer is awaited.
   */
  reason: string | null;
  /** The list is from storage only: the machine has not answered in this page load. */
  lastKnown: boolean;
}

/** One Agent of a mixed list: where it lives (null: this server), and its summary. */
export interface PlacedAgent {
  agent: AgentSummary;
  /** The machine's list it came from; null for this server's Agents. */
  on: MachineAgents | null;
}

/**
 * This server's Agents and every machine's in ONE list, the way the sidebar mixes machine
 * Workspaces with this server's: no machine goes first, everything is ordered by the list's own
 * key — here the Agents list's, oldest created first (the server's order) — and a machine's Agent
 * simply falls where its creation puts it. Ties go by id, then this server's first, then by
 * machine name, so the order is stable. An Agent whose creation time is unknown goes last.
 * `liveOnly` leaves out the machines that cannot be acted on right now.
 */
export function mixAgents(
  here: readonly AgentSummary[],
  lists: readonly MachineAgents[],
  { liveOnly = false }: { liveOnly?: boolean } = {},
): PlacedAgent[] {
  const placed: PlacedAgent[] = [
    ...here.map((agent) => ({ agent, on: null })),
    ...lists
      .filter((list) => !liveOnly || list.live)
      .flatMap((list) => list.agents.map((agent) => ({ agent, on: list }))),
  ];
  const created = (p: PlacedAgent) => p.agent.createdAt ?? "\uffff";
  // Code-point order: an ISO time sorts by its digits, never by a locale's idea of punctuation.
  const byCode = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return placed.sort(
    (a, b) =>
      byCode(created(a), created(b)) ||
      a.agent.agentId.localeCompare(b.agent.agentId) ||
      (a.on === null ? -1 : 0) - (b.on === null ? -1 : 0) ||
      (a.on?.machine.label ?? "").localeCompare(b.on?.machine.label ?? ""),
  );
}

const NO_AGENTS: AgentSummary[] = [];
const NO_LISTS: MachineAgents[] = [];

/**
 * `next`, keeping each element of `prev` that `same` finds equal to its counterpart — and `prev`
 * itself when every element is kept — so an unchanged machine keeps its object across ticks.
 */
function keepSame<T>(prev: readonly T[], next: T[], same: (a: T, b: T) => boolean): T[] {
  const kept = next.map((item) => prev.find((old) => same(old, item)) ?? item);
  return kept.length === prev.length && kept.every((item, i) => item === prev[i])
    ? (prev as T[])
    : kept;
}

const sameMachine = (a: AgentMachineInfo, b: AgentMachineInfo) =>
  a.machineId === b.machineId && a.label === b.label && a.link === b.link && a.port === b.port;

const sameList = (a: MachineAgents, b: MachineAgents) =>
  a.machine === b.machine &&
  a.agents === b.agents &&
  a.live === b.live &&
  a.reason === b.reason &&
  a.lastKnown === b.lastKnown;

/** One machine's list as a page shows it, from its read state. */
function listOf(
  machine: AgentMachineInfo,
  state: ReadState<AgentSummary[]> | undefined,
): MachineAgents {
  const connected = machine.link === "connected";
  const failure = state?.error ?? null;
  const live = connected && state?.fresh === true && failure === null;
  return {
    machine,
    agents: state?.value ?? NO_AGENTS,
    live,
    reason: live
      ? null
      : connected
        ? // Connected and not answered yet is a wait, not a reason.
          failure === null
          ? null
          : remoteAgentsEmpty("connected", failure)
        : remoteAgentsEmpty(machine.link, null),
    lastKnown: state?.value != null && !state.fresh,
  };
}

/**
 * Every machine's Agents for `projectId` (empty for a user with no machines to read), and a way
 * to read one machine — or all of them — again after a write there.
 */
export function useMachineAgents(projectId: string | null): {
  lists: MachineAgents[];
  /**
   * Asks the machine again, or every connected machine when none is named — and tells every
   * other reader of it to (see {@link publishMachineAgentsChanged}).
   */
  reload: (machineId?: string) => void;
} {
  const machines = useMachines();
  /** The machines as last handed out: one whose facts did not change keeps its object. */
  const lastInfos = useRef<AgentMachineInfo[]>([]);
  const infos = keepSame(
    lastInfos.current,
    agentMachines(machines.state, machines.settled),
    sameMachine,
  );
  lastInfos.current = infos;

  const states = useReads(
    agentLists,
    projectId === null
      ? []
      : infos.map((machine) => ({
          key: agentListKey(projectId, machine.machineId),
          run: () => fetchMachineAgents(projectId, machine.machineId),
          // Nothing can be asked of a machine that is not connected: its list stands as last seen.
          enabled: machine.link === "connected",
        })),
  );

  /** The lists as last handed out, for the same reason as the machines. */
  const lastLists = useRef<MachineAgents[]>(NO_LISTS);
  const lists = useMemo(() => {
    const next =
      projectId === null ? NO_LISTS : infos.map((machine, i) => listOf(machine, states[i]));
    lastLists.current = keepSame(lastLists.current, next, sameList);
    return lastLists.current;
  }, [projectId, infos, states]);

  // A machine that left the Project's list takes what was read of it along: nothing will read
  // it again, and a machine added back later starts from its own answer.
  const listed = machines.state === null ? null : infos.map((m) => m.machineId).join(",");
  const lastListed = useRef<{ projectId: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (projectId === null || listed === null) return;
    const ids = listed === "" ? [] : listed.split(",");
    const before = lastListed.current;
    if (before !== null && before.projectId === projectId) {
      for (const gone of before.ids.filter((id) => !ids.includes(id))) {
        for (const key of agentLists.keys(readKey(projectId, gone))) agentLists.forget(key);
      }
    }
    lastListed.current = { projectId, ids };
  }, [projectId, listed]);

  /** The connected machines, as a string: an unchanged set keeps `reload` still. */
  const connectedKey = infos
    .filter((m) => m.link === "connected")
    .map((m) => m.machineId)
    .join(",");
  const reload = useCallback(
    (machineId?: string) => {
      const targets =
        machineId !== undefined ? [machineId] : connectedKey.split(",").filter((id) => id !== "");
      for (const id of targets) publishMachineAgentsChanged(id);
    },
    [connectedKey],
  );

  return { lists, reload };
}

/**
 * The store's read for callers outside React (the sessions store): dedupes with the pages' reads,
 * remembers the answer. A list the machine answered in this page load, with no write or absence
 * since, is answered from the store; otherwise the machine is asked, joining a read already in
 * flight. A failed read rejects with the failure in words.
 */
export async function readMachineAgents(
  projectId: string,
  machineId: string,
): Promise<AgentSummary[]> {
  const key = agentListKey(projectId, machineId);
  const known = agentLists.get(key);
  if (!known.fresh || known.stale || known.reading || known.error !== null) {
    await agentLists.read(key, () => fetchMachineAgents(projectId, machineId));
  }
  const state = agentLists.get(key);
  if (state.error !== null) throw new Error(state.error);
  return state.value ?? NO_AGENTS;
}

/**
 * The machine cannot be asked right now: what it was last seen running stands, and is read again
 * once it is back — by {@link readMachineAgents} as by a page — since it may have changed meanwhile.
 */
export function machineAgentsOutOfReach(projectId: string, machineId: string): void {
  agentLists.invalidate(agentListKey(projectId, machineId));
}

/**
 * The Agents of the server an Agent's page acts on: this server's (the Project's list), or the
 * machine's as it was last read — the Agents page and the session list read it every time they
 * are shown, so a page reached from either has a current one. What a page picks from it (the
 * Project's default Agent, to hand a request to) is then an Agent THAT server runs.
 */
export function useAgentsOn(machineId: string | null): readonly AgentSummary[] {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const onMachine = machineId !== null && projectId !== null;
  const state = useRead(
    agentLists,
    onMachine ? agentListKey(projectId, machineId) : null,
    () => fetchMachineAgents(projectId!, machineId!),
    // Read by the pages that list Agents; this one only shows what they read.
    { enabled: false },
  );
  return onMachine ? (state.value ?? NO_AGENTS) : agents;
}
