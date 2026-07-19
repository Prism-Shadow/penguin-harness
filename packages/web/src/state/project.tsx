/**
 * Current Project / Agent context:
 * - Project list (owned + authorized); the current selection is remembered in localStorage and
 *   synced to server-side prefs (lastProjectId, best-effort);
 * - the current Project's Agent list and current Agent (switched via the top-bar breadcrumb
 *   dropdown; remembered per Project).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, ProjectSummary } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";

const PROJECT_KEY = "penguin.lastProjectId";
const agentKey = (projectId: string) => `penguin.lastAgentId.${projectId}`;

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

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [currentAgentId, setCurrentAgentIdState] = useState<string | null>(null);

  const reloadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await api.listProjects();
      setProjects(res.projects);
      setCurrentProjectIdState((prev) => {
        const wanted = prev ?? localStorage.getItem(PROJECT_KEY);
        const found = res.projects.find((p) => p.projectId === wanted);
        return (found ?? res.projects[0])?.projectId ?? null;
      });
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  const setCurrentProjectId = useCallback(
    (projectId: string) => {
      // If the selection is already the current Project, return immediately. Otherwise the
      // code below would clear agents and set loading back to true while currentProjectId
      // stays unchanged — reloadAgents' effect depends on it and wouldn't rerun, so the Agent
      // list (and the Session list mounted under it) would disappear for good (reproducible
      // by clicking the already-current Project in the dropdown).
      if (projectId === currentProjectId) return;
      localStorage.setItem(PROJECT_KEY, projectId);
      setCurrentProjectIdState(projectId);
      setCurrentAgentIdState(null);
      // Clear the Agent list in sync: avoids a transient render with "new projectId + old
      // Project's agents" that would make downstream consumers (Sessions) fetch with the
      // wrong Agent set (which could create spurious Sessions under the new Project).
      setAgents([]);
      setAgentsLoading(true);
      // Sync server-side prefs (best-effort; failure doesn't affect the local experience).
      void api.putPrefs({ lastProjectId: projectId }).catch(() => undefined);
    },
    [currentProjectId],
  );

  const reloadAgents = useCallback(async () => {
    if (!currentProjectId) return;
    setAgentsLoading(true);
    try {
      const res = await api.listAgents(currentProjectId);
      setAgents(res.agents);
      setCurrentAgentIdState((prev) => {
        const wanted = prev ?? localStorage.getItem(agentKey(currentProjectId));
        const found = res.agents.find((a) => a.agentId === wanted);
        // Default to conversing with default_agent.
        const fallback =
          res.agents.find((a) => a.agentId === "default_agent") ?? res.agents[0] ?? null;
        return (found ?? fallback)?.agentId ?? null;
      });
    } finally {
      setAgentsLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    setAgents([]);
    void reloadAgents();
  }, [reloadAgents]);

  const setCurrentAgentId = useCallback(
    (agentId: string) => {
      if (currentProjectId) localStorage.setItem(agentKey(currentProjectId), agentId);
      setCurrentAgentIdState(agentId);
    },
    [currentProjectId],
  );

  const value = useMemo<ProjectContextValue>(() => {
    const currentProject = projects.find((p) => p.projectId === currentProjectId) ?? null;
    const currentAgent = agents.find((a) => a.agentId === currentAgentId) ?? null;
    return {
      projects,
      projectsLoading,
      currentProject,
      setCurrentProjectId,
      reloadProjects,
      agents,
      agentsLoading,
      currentAgent,
      setCurrentAgentId,
      reloadAgents,
    };
  }, [
    projects,
    projectsLoading,
    currentProjectId,
    setCurrentProjectId,
    reloadProjects,
    agents,
    agentsLoading,
    currentAgentId,
    setCurrentAgentId,
    reloadAgents,
  ]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject 必须在 ProjectProvider 内使用");
  return ctx;
}
