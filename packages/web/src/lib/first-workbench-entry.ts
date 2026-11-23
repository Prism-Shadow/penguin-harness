import { useEffect, useState } from "react";
import { getAgentPlugins, getWorkbench } from "../api/endpoints";
import type { PageAgent } from "./page-agent";
import { runningWorkbenches } from "./workbench-tabs";

export const GUIDE_ID = "first-workbench-guide";
export const GUIDE_START = "penguin:start-first-workbench";
export function startFirstWorkbench(scope: PageAgent) {
  window.dispatchEvent(new CustomEvent(GUIDE_START, { detail: scope }));
}

/** Availability follows the installed workbench's Agent-wide and individual switches. */
export function useFirstWorkbench(scope: PageAgent | null) {
  const [available, setAvailable] = useState<string | null>(null);
  const project = scope?.projectId,
    agent = scope?.agentId,
    machine = scope?.machineId ?? null;
  const key = JSON.stringify([project, agent, machine]);
  useEffect(() => {
    if (!project || !agent) return;
    let current = true;
    const refresh = () => {
      void Promise.all([
        getWorkbench(project, agent, GUIDE_ID, machine),
        getAgentPlugins(project, agent, machine),
      ])
        .then(([result, installed]) => {
          if (current)
            setAvailable(
              installed.workbenches?.some((w) => w.name === GUIDE_ID && w.plugin === GUIDE_ID) &&
                runningWorkbenches(result).some(
                  (w) =>
                    w.id === GUIDE_ID &&
                    !w.error &&
                    w.tabs.some((t) => t.id === "first-workbench-guide.main"),
                )
                ? key
                : null,
            );
        })
        .catch(() => {
          if (current) setAvailable(null);
        });
    };
    refresh();
    window.addEventListener("penguin:workbench-updated", refresh);
    return () => {
      current = false;
      window.removeEventListener("penguin:workbench-updated", refresh);
    };
  }, [project, agent, machine, key]);
  return available === key && !!project;
}
