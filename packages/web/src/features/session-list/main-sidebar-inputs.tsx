import { useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { useCompany } from "../../lib/company-context";
import { parseOrgKey } from "../company";
import type {
  MainSidebarProps,
  SidebarNavSelector,
  SidebarPagesReader,
} from "../../lib/main-sidebar-bindings";

/** Consecutive live main statements 0..14, called once in original hook order. */
export function useMainSidebarInputs(
  props: MainSidebarProps,
  navPagesOf: SidebarNavSelector,
  useWebAppPages: SidebarPagesReader,
) {
  const { onNavigate, onCollapse, initialSearchOpen = false } = props;

  const navigate = useNavigate();
  const location = useLocation();
  const { user, sessionVia } = useAuth();
  const { locale } = useLocale();
  const {
    projects,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    agents,
    setCurrentAgentId,
  } = useProject();
  const {
    sessions: allSessions,
    byAgent: allByAgent,
    countsByAgent,
    workspaceCountsByAgent,
    workspaceLatestActiveByAgent,
    machineLabels,
    machineIds,
    isLoadedFor,
    hasMoreFor,
    activityWatermarkFor,
    loadMoreFor,
    loading,
    remove,
    replace,
  } = useSessions();
  const chatMatch = useMatch("/chat/:sessionId");
  const activeSessionId = chatMatch?.params.sessionId ?? null;

  const [projectOpen, setProjectOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  /** The badges over the update and to-do trails (use-update-badges.ts); the avatar's dot follows the update flow's offer / restart states. */
  const badges = useUpdateBadges();
  const company = useCompany();
  /** Company mode swaps the Project switcher, the page nav and the session list for their organization forms. */
  const inCompany = company.workMode === "company";
  /** The organization the company nav points at: the open one, else the one last opened (the switcher names the same). */
  const navOrg = parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);
  return {
    onNavigate,
    onCollapse,
    initialSearchOpen,
    navPagesOf,
    useWebAppPages,
    navigate,
    location,
    user,
    sessionVia,
    locale,
    projects,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    agents,
    setCurrentAgentId,
    allSessions,
    allByAgent,
    countsByAgent,
    workspaceCountsByAgent,
    workspaceLatestActiveByAgent,
    machineLabels,
    machineIds,
    isLoadedFor,
    hasMoreFor,
    activityWatermarkFor,
    loadMoreFor,
    loading,
    remove,
    replace,
    chatMatch,
    activeSessionId,
    projectOpen,
    setProjectOpen,
    createProjectOpen,
    setCreateProjectOpen,
    projectSettingsOpen,
    setProjectSettingsOpen,
    badges,
    company,
    inCompany,
    navOrg,
  };
}
