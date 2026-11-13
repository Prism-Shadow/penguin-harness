import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { noteSessionSeen } from "../../lib/session-seen";
import type { useMainSidebarApplyRegistryChange } from "./main-sidebar-apply-registry-change";

/** Consecutive live main statements 132..133, called once in original hook order. */
export function useMainSidebarOpenSession(
  scope: ReturnType<typeof useMainSidebarApplyRegistryChange>,
) {
  const { setCurrentAgentId, modes, modeStates, currentMode, modeKey, currentProjectId, go } =
    scope;

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
  const switchMode = (key: string) => {
    if (key === modeKey) return;
    let to = currentMode < 0 ? null : modeStates[currentMode]!.select(false);
    const target = modes.findIndex((mode) => mode.key === key);
    if (target >= 0) to = modeStates[target]!.select(true);
    if (to !== null) go(to);
  };
  return { ...scope, openSession, switchMode };
}
