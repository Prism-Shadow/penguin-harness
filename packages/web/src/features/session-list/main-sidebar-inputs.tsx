import { sectionsIn, currentModeIndex } from "../../lib/sidebar-modes";
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
  SidebarBindingReader,
  SidebarNavSelector,
  SidebarPagesReader,
} from "../../lib/main-sidebar-bindings";

/** Consecutive live main statements 0..18, called once in original hook order. */
export function useMainSidebarInputs(
  props: MainSidebarProps,
  navPagesOf: SidebarNavSelector,
  useWebAppPages: SidebarPagesReader,
  useSidebarBindings: SidebarBindingReader,
) {
  const { onNavigate, onCollapse, initialSearchOpen = false } = props;

  const navigate = useNavigate();
  const location = useLocation();
  const { user, sessionVia } = useAuth();
  const { locale } = useLocale();
  const { currentProject, agents, setCurrentAgentId } = useProject();
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

  /** The badges over the update and to-do trails (use-update-badges.ts); the avatar's dot follows the update flow's offer / restart states. */
  const badges = useUpdateBadges();
  const { sections, modes, badges: slotBadges, useModes, useNotes } = useSidebarBindings();
  const modeStates = useModes();
  const currentMode = currentModeIndex(modeStates);
  const modeKey = currentMode < 0 ? "dev" : modes[currentMode]!.key;
  const notes = useNotes();
  const offeredModes = modes.filter((_, i) => modeStates[i]!.available);
  const renderSections = (place: "header" | "body") =>
    sectionsIn(sections, modeKey, place).map(({ id, section: { Full } }) => (
      <Full key={id} {...(onNavigate ? { onNavigate } : {})} />
    ));
  const company = useCompany();
  /** Company mode swaps the Project switcher, the page nav and the session list for their organization forms. */
  const inCompany = currentMode >= 0;
  /** The organization the company nav points at: the open one, else the one last opened (the switcher names the same). */
  const navOrg = parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);
  return {
    onNavigate,
    onCollapse,
    initialSearchOpen,
    navPagesOf,
    useWebAppPages,
    useSidebarBindings,
    navigate,
    location,
    user,
    sessionVia,
    locale,
    currentProject,
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
    badges,
    sections,
    modes,
    slotBadges,
    useModes,
    useNotes,
    modeStates,
    currentMode,
    modeKey,
    notes,
    offeredModes,
    renderSections,
    company,
    inCompany,
    navOrg,
  };
}
