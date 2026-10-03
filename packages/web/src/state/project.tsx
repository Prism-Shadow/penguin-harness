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
 *
 * The Agent list follows lib/project-scope.ts: it is held tagged with the Project it was listed
 * for, an answer is applied only while that Project is still current (a late list of the
 * Project just left is dropped), and the context publishes only the current Project's list.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, ProjectSummary } from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { isCurrentProject, scoped, scopedValue, type Scoped } from "../lib/project-scope";
import { WORKBENCH_UPDATED_EVENT, type WorkbenchUpdatedDetail } from "../lib/workbench-tabs";

const PROJECT_KEY = "penguin.lastProjectId";
const agentKey = (projectId: string) => `penguin.lastAgentId.${projectId}`;

/**
 * Remembers a Project and Agent the way the store does, for a surface that sits outside the
 * ProjectProvider (the full-page workbench route) and wants the shell to open on them next.
 */
export function rememberSelection(projectId: string, agentId: string): void {
  localStorage.setItem(PROJECT_KEY, projectId);
  localStorage.setItem(agentKey(projectId), agentId);
}

interface ProjectContextValue {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProject: ProjectSummary | null;
  setCurrentProjectId: (projectId: string) => void;
  reloadProjects: () => Promise<void>;

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

/** Store state: the context value's raw ingredients (currentProject/agents/currentAgent are derived by projectView) plus the mutation functions. */
interface ProjectStoreState {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  currentProjectId: string | null;

  /** The last Agent list applied, tagged with the Project it was listed for; null before any. */
  agents: Scoped<AgentSummary[]> | null;
  /** No list of the current Project has been applied yet, and one is being read. */
  agentsLoading: boolean;
  currentAgentId: string | null;

  setCurrentProjectId: (projectId: string) => void;
  reloadProjects: () => Promise<void>;
  setCurrentAgentId: (agentId: string) => void;
  reloadAgents: () => Promise<void>;
}

/**
 * What moving to another Project resets, in the same update that moves it: the current Agent
 * and the Agent list are the previous Project's, and nothing may read them as the new one's.
 */
function enteredProject(projectId: string | null): Partial<ProjectStoreState> {
  return { currentProjectId: projectId, currentAgentId: null, agents: null, agentsLoading: true };
}

function createProjectStore() {
  /** Agent-list asks so far: only the newest one's answer is applied (see reloadAgents). */
  let agentsAsked = 0;
  return createStore<ProjectStoreState>((set, get) => ({
    projects: [],
    projectsLoading: true,
    currentProjectId: null,

    agents: null,
    agentsLoading: true,
    currentAgentId: null,

    reloadProjects: async () => {
      set({ projectsLoading: true });
      try {
        const res = await api.listProjects();
        const wanted = get().currentProjectId ?? localStorage.getItem(PROJECT_KEY);
        const found = res.projects.find((p) => p.projectId === wanted);
        const next = (found ?? res.projects[0])?.projectId ?? null;
        // The current Project gone from the list (deleted, access lost) moves the app to another
        // one: a switch like any other, so it resets what a switch resets, in the same update.
        set({
          projects: res.projects,
          ...(next === get().currentProjectId ? {} : enteredProject(next)),
        });
      } finally {
        set({ projectsLoading: false });
      }
    },

    setCurrentProjectId: (projectId) => {
      // If the selection is already the current Project, return immediately. Otherwise the
      // code below would clear agents and set loading back to true while currentProjectId
      // stays unchanged — the Provider's reloadAgents effect depends on it and wouldn't rerun,
      // so the Agent list (and the Session list mounted under it) would disappear for good
      // (reproducible by clicking the already-current Project in the dropdown).
      if (projectId === get().currentProjectId) return;
      localStorage.setItem(PROJECT_KEY, projectId);
      // Clear the Agent list in sync: avoids a transient render with "new projectId + old
      // Project's agents" that would make downstream consumers (Sessions) fetch with the
      // wrong Agent set (which could create spurious Sessions under the new Project).
      set(enteredProject(projectId));
      // Sync server-side prefs (best-effort; failure doesn't affect the local experience).
      void api.putPrefs({ lastProjectId: projectId }).catch(() => undefined);
    },

    reloadAgents: async () => {
      const projectId = get().currentProjectId;
      if (!projectId) return;
      const ask = ++agentsAsked;
      // The answer is applied only while it is the newest ask and its Project is still the
      // current one. A list of the Project just left that answers after the switch — slow
      // network, slow machine, a reload fired by the turn that just ended there — would
      // otherwise land as the new Project's Agents, and every page would then pair the new
      // Project with Agents it does not have.
      const applies = () =>
        ask === agentsAsked && isCurrentProject(projectId, get().currentProjectId);
      // Loading means no list of this Project yet. A reload (after a delete, a create, a kernel
      // update, a finished turn) keeps the list it has on screen until the new one lands: raising
      // the flag would swap every page that waits on it for its skeleton and back.
      if (scopedValue(get().agents, projectId) === null) set({ agentsLoading: true });
      try {
        const res = await api.listAgents(projectId, null);
        if (!applies()) return;
        const wanted = get().currentAgentId ?? localStorage.getItem(agentKey(projectId));
        set({
          agents: scoped(projectId, res.agents),
          currentAgentId: agentOf(res.agents, wanted)?.agentId ?? null,
        });
      } finally {
        if (applies()) set({ agentsLoading: false });
      }
    },

    setCurrentAgentId: (agentId) => {
      const currentProjectId = get().currentProjectId;
      if (currentProjectId) localStorage.setItem(agentKey(currentProjectId), agentId);
      set({ currentAgentId: agentId });
    },
  }));
}

/**
 * The Agent an id names among THIS server's, else the one a conversation defaults to
 * (`default_agent`, then the first). The id may name an Agent only a machine has — a draft or
 * a Session on that machine follows its pick through to the current Agent — and the current
 * Agent is never one of those: the chat page renders nothing until there is a current Agent,
 * so resolving such an id to null left every chat route on its placeholder until a reload.
 */
export function agentOf(
  agents: readonly AgentSummary[],
  agentId: string | null,
): AgentSummary | null {
  return (
    agents.find((a) => a.agentId === agentId) ??
    agents.find((a) => a.agentId === "default_agent") ??
    agents[0] ??
    null
  );
}

/** Published while no Agent list of the current Project has been applied: one identity, so effects keyed on it stay put. */
const NO_AGENTS: AgentSummary[] = [];

/**
 * What the context publishes from the store: the current Project, its Agents and the current
 * Agent. The Agent list is handed out only when it was listed for the current Project — never
 * another Project's, whichever write left it there — and the current Agent is one of it.
 */
function projectView(
  state: Pick<ProjectStoreState, "projects" | "currentProjectId" | "agents" | "currentAgentId">,
): {
  currentProject: ProjectSummary | null;
  agents: AgentSummary[];
  currentAgent: AgentSummary | null;
} {
  const currentProject = state.projects.find((p) => p.projectId === state.currentProjectId) ?? null;
  const agents = scopedValue(state.agents, state.currentProjectId) ?? NO_AGENTS;
  return { currentProject, agents, currentAgent: agentOf(agents, state.currentAgentId) };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createProjectStore);
  const state = useStore(store);

  useEffect(() => {
    void store.getState().reloadProjects();
  }, [store]);

  const { currentProjectId } = state;
  useEffect(() => {
    void store.getState().reloadAgents();
  }, [store, currentProjectId]);

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (detail.projectId === store.getState().currentProjectId)
        void store.getState().reloadAgents();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, changed);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, changed);
  }, [store]);

  const value = useMemo<ProjectContextValue>(() => {
    const { currentProject, agents, currentAgent } = projectView(state);
    return {
      projects: state.projects,
      projectsLoading: state.projectsLoading,
      currentProject,
      setCurrentProjectId: state.setCurrentProjectId,
      reloadProjects: state.reloadProjects,
      agents,
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
