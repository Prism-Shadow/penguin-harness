/**
 * The Agents of each machine, as the Agents page and the plugin market list them.
 *
 * A machine's Agents are that machine's own (lib/agent-location.ts): each machine contributes its
 * own list, kept apart from this server's and from every other machine's, even where ids repeat.
 * The machines are the Project's installed ones, read from the one live account of the machines
 * (state/machines.tsx), so a list follows a machine the moment the Machines page sees it change.
 *
 * A connected machine is asked, and its answer is remembered (lib/machine-cache.ts) — the same
 * account the composer offers a remote draft. A machine that is not connected, or that failed to
 * answer, contributes what it was last seen holding, marked as not live and with the reason in
 * the words the composer uses: a list that silently dropped a machine's Agents would read as
 * Agents lost rather than as a machine out of reach.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { apiErrorText } from "./api-error";
import { cachedMachineAgents, rememberMachineAgents } from "./machine-cache";
import { machineLink, remoteAgentsEmpty } from "./machine-link";
import type { MachineLink } from "./machine-link";
import { scoped, scopedValue } from "./project-scope";
import type { Scoped } from "./project-scope";
import { useMachines } from "../state/machines";
import { useProject } from "../state/project";

const changeListeners = new Set<(machineId: string) => void>();

/**
 * A machine's Agents changed under the page — one was created or deleted there, or a plugin
 * install moved its counts: every reader of that machine's list asks it again, the session list
 * included (it lists a Session of a machine's Agent only while that machine names the Agent).
 */
export function publishMachineAgentsChanged(machineId: string): void {
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
  /** What the machine answered now (`live`), or what it was last seen holding. */
  agents: AgentSummary[];
  /** The machine answered this list just now: its Agents can be acted on. */
  live: boolean;
  /** Why the list is not live, in words; null when it is, and while its first answer is awaited. */
  reason: string | null;
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

/** A machine's answer: its Agents, or the failure in words. */
type Answer = { agents: AgentSummary[] } | { error: string };

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
  const infos = useMemo(
    () => agentMachines(machines.state, machines.settled),
    [machines.state, machines.settled],
  );
  /** The connected machines, as a string: an unchanged set keeps the effect below still. */
  const connectedKey = infos
    .filter((m) => m.link === "connected")
    .map((m) => m.machineId)
    .join(",");
  /**
   * The machines' answers, tagged with the Project they were read for (lib/project-scope.ts):
   * the reset below lags a Project switch by one commit, and in that commit the previous
   * Project's answers are not this one's.
   */
  const [answers, setAnswers] = useState<Scoped<ReadonlyMap<string, Answer>> | null>(null);
  /** The Project the page is on now: an answer about another is dropped. */
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  /** Per machine, the read whose answer counts: a later read of that machine outdates it. */
  const generation = useRef(new Map<string, number>());

  const read = useCallback((askProject: string, machineId: string) => {
    const gen = (generation.current.get(machineId) ?? 0) + 1;
    generation.current.set(machineId, gen);
    const current = () =>
      currentProject.current === askProject && generation.current.get(machineId) === gen;
    /** The Project's answers so far, with this machine's set to `answer`. */
    const withAnswer = (
      prev: Scoped<ReadonlyMap<string, Answer>> | null,
      answer: Answer,
    ): Scoped<ReadonlyMap<string, Answer>> =>
      scoped(askProject, new Map(scopedValue(prev, askProject)).set(machineId, answer));
    api.listAgents(askProject, machineId).then(
      (res) => {
        if (!current()) return;
        rememberMachineAgents(askProject, machineId, res.agents);
        setAnswers((prev) => withAnswer(prev, { agents: res.agents }));
      },
      (err: unknown) => {
        if (!current()) return;
        setAnswers((prev) => withAnswer(prev, { error: apiErrorText(err) }));
      },
    );
  }, []);

  useEffect(() => {
    setAnswers(null);
  }, [projectId]);

  /** The connected machines as last rendered, for a change heard between renders. */
  const connected = useRef(connectedKey);
  connected.current = connectedKey;
  useEffect(
    () =>
      subscribeMachineAgentsChanged((machineId) => {
        const askProject = currentProject.current;
        if (askProject !== null && connected.current.split(",").includes(machineId)) {
          read(askProject, machineId);
        }
      }),
    [read],
  );

  // Every connected machine, read when the set changes (a machine came back, the Project moved).
  useEffect(() => {
    if (projectId === null || connectedKey === "") return;
    for (const machineId of connectedKey.split(",")) read(projectId, machineId);
  }, [projectId, connectedKey, read]);

  const reload = useCallback(
    (machineId?: string) => {
      const targets =
        machineId !== undefined ? [machineId] : connectedKey.split(",").filter((id) => id !== "");
      for (const id of targets) publishMachineAgentsChanged(id);
    },
    [connectedKey],
  );

  const lists = useMemo(() => {
    if (projectId === null) return [];
    const answered = scopedValue(answers, projectId);
    return infos.map((machine): MachineAgents => {
      const answer = machine.link === "connected" ? answered?.get(machine.machineId) : undefined;
      if (answer !== undefined && "agents" in answer) {
        return { machine, agents: answer.agents, live: true, reason: null };
      }
      const failure = answer !== undefined && "error" in answer ? answer.error : null;
      return {
        machine,
        agents: cachedMachineAgents(projectId, machine.machineId),
        live: false,
        // Connected and not answered yet is a wait, not a reason.
        reason:
          machine.link === "connected" && failure === null
            ? null
            : remoteAgentsEmpty(machine.link, failure),
      };
    });
  }, [projectId, infos, answers]);

  return { lists, reload };
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
  return useMemo(
    () =>
      machineId === null || projectId === null ? agents : cachedMachineAgents(projectId, machineId),
    [machineId, projectId, agents],
  );
}
