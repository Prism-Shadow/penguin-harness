import { useMemo } from "react";
import { agentDisplayName } from "../../state/project";
import type { useMainSidebarOpenSession } from "./main-sidebar-open-session";

/** Consecutive live main statements 127..127, called once in original hook order. */
export function useMainSidebarAgentNameById(scope: ReturnType<typeof useMainSidebarOpenSession>) {
  const { agents } = scope;

  /** agentId → display name (row hint tooltips in workspace mode). */
  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, agentDisplayName(a)])),
    [agents],
  );
  return { ...scope, agentNameById };
}
