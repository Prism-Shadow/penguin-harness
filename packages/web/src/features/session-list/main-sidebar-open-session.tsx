import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { noteSessionSeen } from "../../lib/session-seen";
import { isOrgRoute, type WorkMode } from "../company";

import type { useMainSidebarApplyRegistryChange } from "./main-sidebar-apply-registry-change";

/** Consecutive live main statements 128..129, called once in original hook order. */
export function useMainSidebarOpenSession(
  scope: ReturnType<typeof useMainSidebarApplyRegistryChange>,
) {
  const { location, setCurrentAgentId, company, currentProjectId, go } = scope;

  const openSession = (s: SessionInfo) => {
    // Opening is what "read" means here: stamp the marker before navigating.
    noteSessionSeen(currentProjectId, s.sessionId, s.lastActiveAt);
    // Cross-group click: the current Agent follows this Session's own Agent.
    setCurrentAgentId(s.agentId);
    go(`/chat/${s.sessionId}`);
  };

  /**
   * The mode switch: company mode enters at `/org` (the organization last opened, else the
   * first); development mode keeps whatever conversation is open and only leaves an
   * organization page, which has no development form.
   */
  const switchMode = (mode: WorkMode) => {
    if (mode === company.workMode) return;
    company.setWorkMode(mode);
    if (mode === "company") go("/org");
    else if (isOrgRoute(location.pathname)) go("/chat");
  };
  return { ...scope, openSession, switchMode };
}
