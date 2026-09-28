/**
 * Current Project / Agent context:
 * - Project list (owned + authorized); the current selection is remembered in localStorage and
 *   synced to server-side prefs (lastProjectId, best-effort);
 * - the current Project's Agent list and current Agent (switched via the top-bar breadcrumb
 *   dropdown; remembered per Project).
 *
 * State lives in a zustand vanilla store (one instance per Provider mount, so an unmount
 * still resets everything); the Provider is a thin lifecycle component that triggers the
 * initial fetches and republishes the store's state through the same context value as before.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, ProjectSummary } from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";

const PROJECT_KEY = "penguin.lastProjectId";
const agentKey = (projectId: string) => `penguin.lastAgentId.${projectId}`;

interface ProjectContextValue {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProject: ProjectSummary | null;
  /** A removed selection whose local editor declined to leave; never an accessible Project. */
  unavailableProjectId: string | null;
  setCurrentProjectId: (projectId: string) => void;
  /**
   * `guard(retry)` returns whether it's fine to proceed now. A guard that needs to ask first
   * (through its own dialog) returns false immediately and calls `retry()` later if the
   * answer is to go ahead — `retry` re-runs the exact same operation, which will consult the
   * guard again (now free to return true). A guard with nothing to ask just ignores `retry`.
   */
  registerProjectChangeGuard: (guard: (retry: () => void) => boolean) => () => void;
  reloadProjects: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;

  agents: AgentSummary[];
  agentsLoading: boolean;
  currentAgent: AgentSummary | null;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Project display name fallback: falls back to projectId when name is absent. */
export function projectDisplayName(p: ProjectSummary): string {
  return p.name ?? p.projectId;
}

/** Agent display name fallback: falls back to agentId when name is absent. */
export function agentDisplayName(a: AgentSummary): string {
  return a.name ?? a.agentId;
}

/** Store state: the context value's raw ingredients (currentProject/currentAgent are derived in the Provider) plus the mutation functions. */
interface ProjectStoreState {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProjectId: string | null;
  unavailableProjectId: string | null;

  agents: AgentSummary[];
  agentsLoading: boolean;
  currentAgentId: string | null;

  setCurrentProjectId: (projectId: string) => void;
  registerProjectChangeGuard: (guard: (retry: () => void) => boolean) => () => void;
  reloadProjects: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

/**
 * Runs every registered project-change guard, in the shape `registerProjectChangeGuard`
 * expects: each guard decides synchronously whether it's fine to proceed now, or asks its
 * own question and calls `retry` later once answered "go ahead" — `retry` replays the exact
 * operation, which consults the guards again. `.every` short-circuits on the first "no", so
 * a guard after a declining one is never even asked (only one editor guard is registered in
 * practice, but this keeps the aggregation honest if that ever changes).
 */
export function combineChangeGuards(
  guards: Iterable<(retry: () => void) => boolean>,
  retry: () => void,
): boolean {
  return [...guards].every((guard) => guard(retry));
}

export function createProjectStore() {
  const changeGuards = new Set<(retry: () => void) => boolean>();
  const canLeave = (retry: () => void) => combineChangeGuards(changeGuards, retry);
  const rememberProject = (projectId: string) => {
    localStorage.setItem(PROJECT_KEY, projectId);
    void api.putPrefs({ lastProjectId: projectId }).catch(() => undefined);
  };
  const store = createStore<ProjectStoreState>((set, get) => ({
    projects: [],
    projectsLoading: true,
    currentProjectId: null,
    unavailableProjectId: null,

    agents: [],
    agentsLoading: true,
    currentAgentId: null,

    registerProjectChangeGuard: (guard) => {
      changeGuards.add(guard);
      return () => {
        changeGuards.delete(guard);
      };
    },

    reloadProjects: () => loadProjects(),
    deleteProject: async (projectId) => {
      // Confirm before the irreversible request. A refresh after this same deletion
      // must not ask again after the Project is already gone. `retry` replays this exact
      // call once a guard's own dialog (e.g. discarding unsaved edits) is answered "go
      // ahead" — canLeave then sees no more dirty editors and returns true.
      const selected = get().currentProjectId ?? get().unavailableProjectId;
      if (projectId === selected && !canLeave(() => void get().deleteProject(projectId)))
        return false;
      await api.deleteProject(projectId);
      await loadProjects(projectId);
      return true;
    },

    setCurrentProjectId: (projectId) => {
      // If the selection is already the current Project, return immediately. Otherwise the
      // code below would clear agents and set loading back to true while currentProjectId
      // stays unchanged — the Provider's reloadAgents effect depends on it and wouldn't rerun,
      // so the Agent list (and the Session list mounted under it) would disappear for good
      // (reproducible by clicking the already-current Project in the dropdown).
      if (projectId === get().currentProjectId) return;
      if (!get().projects.some((project) => project.projectId === projectId)) return;
      // Project selection is independent of the router. Consult editors before any
      // selection, agent, localStorage, or server preference mutation takes place. `retry`
      // replays this same call once a guard answers "go ahead" (e.g. after discarding).
      if (!canLeave(() => get().setCurrentProjectId(projectId))) return;
      rememberProject(projectId);
      // Clear the Agent list in sync: avoids a transient render with "new projectId + old
      // Project's agents" that would make downstream consumers (Sessions) fetch with the
      // wrong Agent set (which could create spurious Sessions under the new Project).
      set({
        currentProjectId: projectId,
        unavailableProjectId: null,
        currentAgentId: null,
        agents: [],
        agentsLoading: true,
      });
    },

    reloadAgents: async () => {
      const currentProjectId = get().currentProjectId;
      if (!currentProjectId) return;
      set({ agentsLoading: true });
      try {
        const res = await api.listAgents(currentProjectId);
        if (get().currentProjectId !== currentProjectId) return;
        const wanted = get().currentAgentId ?? localStorage.getItem(agentKey(currentProjectId));
        const found = res.agents.find((a) => a.agentId === wanted);
        // Default to conversing with default_agent.
        const fallback =
          res.agents.find((a) => a.agentId === "default_agent") ?? res.agents[0] ?? null;
        set({ agents: res.agents, currentAgentId: (found ?? fallback)?.agentId ?? null });
      } finally {
        if (get().currentProjectId === currentProjectId) set({ agentsLoading: false });
      }
    },

    setCurrentAgentId: (agentId) => {
      const currentProjectId = get().currentProjectId;
      if (currentProjectId) localStorage.setItem(agentKey(currentProjectId), agentId);
      set({ currentAgentId: agentId });
    },
  }));

  async function loadProjects(approvedRemoval?: string): Promise<void> {
    store.setState({ projectsLoading: true });
    try {
      const { projects } = await api.listProjects();
      const state = store.getState();
      const previous = state.currentProjectId ?? state.unavailableProjectId;
      const wanted = previous ?? localStorage.getItem(PROJECT_KEY);
      const found = projects.find((project) => project.projectId === wanted);
      const next = (found ?? projects[0])?.projectId ?? null;
      if (
        previous &&
        next !== previous &&
        approvedRemoval !== previous &&
        // `retry` replays this same reload once a guard answers "go ahead" (e.g. after
        // discarding unsaved edits) — canLeave then returns true and the switch proceeds.
        !canLeave(() => void loadProjects(approvedRemoval))
      ) {
        // Access is gone regardless of the answer. Keep only an ID so an editor can
        // retain its local text, while every other consumer sees no active Project.
        store.setState({
          projects,
          currentProjectId: null,
          unavailableProjectId: previous,
          agents: [],
          currentAgentId: null,
          agentsLoading: false,
        });
        return;
      }
      store.setState({
        projects,
        currentProjectId: next,
        unavailableProjectId: null,
        ...(state.currentProjectId !== next
          ? { agents: [], currentAgentId: null, agentsLoading: next !== null }
          : {}),
      });
      if (previous && next && next !== previous) rememberProject(next);
    } finally {
      store.setState({ projectsLoading: false });
    }
  }
  return store;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createProjectStore);
  const state = useStore(store);

  useEffect(() => {
    void store.getState().reloadProjects();
  }, [store]);

  const { currentProjectId } = state;
  useEffect(() => {
    store.setState({ agents: [] });
    void store.getState().reloadAgents();
  }, [store, currentProjectId]);

  const value = useMemo<ProjectContextValue>(() => {
    const currentProject =
      state.projects.find((p) => p.projectId === state.currentProjectId) ?? null;
    const currentAgent = state.agents.find((a) => a.agentId === state.currentAgentId) ?? null;
    return {
      projects: state.projects,
      projectsLoading: state.projectsLoading,
      currentProject,
      unavailableProjectId: state.unavailableProjectId,
      setCurrentProjectId: state.setCurrentProjectId,
      registerProjectChangeGuard: state.registerProjectChangeGuard,
      reloadProjects: state.reloadProjects,
      deleteProject: state.deleteProject,
      agents: state.agents,
      agentsLoading: state.agentsLoading,
      currentAgent,
      setCurrentAgentId: state.setCurrentAgentId,
      reloadAgents: state.reloadAgents,
    };
  }, [state]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
