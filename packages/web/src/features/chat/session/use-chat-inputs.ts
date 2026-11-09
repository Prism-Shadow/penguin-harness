/**
 * What the chat page starts from: the route, the signed-in user, the display currency, the
 * current Project with its Agents, and its Session list.
 */
import { useLocation, useNavigate, useParams } from "react-router";
import { useAuth } from "../../../state/auth";
import { useTheme } from "../../../state/theme";
import { useProject } from "../../../state/project";
import { useSessions } from "../../../state/sessions";

export function useChatInputs() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ sessionId?: string }>();
  const { user } = useAuth();
  const { currency } = useTheme();
  const { currentProject, currentAgent, setCurrentAgentId, reloadAgents, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const agentId = currentAgent?.agentId ?? null;
  const {
    sessions,
    loading: sessionsLoading,
    machineLabels,
    machinesUnreachable,
    offlineMachineIds,
    reload: reloadSessions,
    add: addSession,
    isDeleted: isSessionDeleted,
    replace,
    setStatus,
    setTitle,
  } = useSessions();
  const routeSessionId = params.sessionId ?? null;
  return {
    navigate,
    location,
    routeSessionId,
    user,
    currency,
    currentAgent,
    setCurrentAgentId,
    reloadAgents,
    agents,
    projectId,
    agentId,
    sessions,
    sessionsLoading,
    machineLabels,
    machinesUnreachable,
    offlineMachineIds,
    reloadSessions,
    addSession,
    isSessionDeleted,
    replace,
    setStatus,
    setTitle,
  };
}

export type ChatInputs = ReturnType<typeof useChatInputs>;
