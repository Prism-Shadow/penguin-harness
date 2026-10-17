/**
 * Pages whose address names something of one Project — an Agent (`/agents/:agentId`), a
 * Benchmark (`/benchmark/:benchmarkId`), an Agent filter (`/usage?agentId=`) — belong to the
 * Project they were opened in (lib/project-scope.ts). Asked under another Project, the same id
 * names another thing or nothing at all.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

/** The first Project this mounted page was shown under; null until the Project is known. */
export function useOpenedInProject(projectId: string | null): string | null {
  const openedIn = useRef<string | null>(null);
  if (openedIn.current === null) openedIn.current = projectId;
  return openedIn.current;
}

/**
 * Leaves for `to` — the new Project's list — once the current Project is no longer the one the
 * page was opened in. Returns whether it has switched away, so the page renders nothing, and
 * asks nothing, in the commit before the navigation lands.
 */
export function useLeaveOnProjectSwitch(projectId: string | null, to: string): boolean {
  const navigate = useNavigate();
  const switchedAway = projectId !== useOpenedInProject(projectId);
  useEffect(() => {
    if (switchedAway) navigate(to, { replace: true });
  }, [switchedAway, navigate, to]);
  return switchedAway;
}
