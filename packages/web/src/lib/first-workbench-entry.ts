import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { getAgentPlugins, getWorkbench } from "../api/endpoints";
import type { PageAgent } from "./page-agent";
import { runningWorkbenches, workbenchesBase } from "./workbench-tabs";

export const GUIDE_ID = "first-workbench-guide";
export const GUIDE_MODEL_SELECTED = "penguin:composer-model-selected";
export const GUIDE_START = "penguin:start-first-workbench";
export function startFirstWorkbench(scope: PageAgent) {
  window.dispatchEvent(new CustomEvent(GUIDE_START, { detail: scope }));
}

/** The Agent's installed plugin owns the guide. Its background handler has no application tab. */
export function useFirstWorkbench(scope: PageAgent | null): boolean | null {
  const [result, setResult] = useState<{ key: string; available: boolean } | null>(null);
  const project = scope?.projectId,
    agent = scope?.agentId,
    machine = scope?.machineId ?? null;
  const key = JSON.stringify([project, agent, machine]);
  useEffect(() => {
    if (!project || !agent || import.meta.env.PUBLIC_PRODUCT_DEMO) return;
    let current = true;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      let available = false;
      try {
        const installed = await getAgentPlugins(project, agent, machine);
        if (
          installed.workbenches?.some((item) => item.plugin === GUIDE_ID && item.name === GUIDE_ID)
        ) {
          const handler = await getWorkbench(project, agent, GUIDE_ID, machine);
          const guide = runningWorkbenches(handler).find(
            (item) => item.id === GUIDE_ID && !item.error,
          );
          if (guide) {
            // Older installations exposed a guide tab. A handler-only installation declares its entry.
            available =
              guide.tabs.length > 0 ||
              (
                await apiFetch<{ onboarding?: string }>(
                  workbenchesBase(project, agent) + "/" + GUIDE_ID + "/api/capabilities",
                  { server: machine },
                )
              ).onboarding === "first-workbench";
          }
        }
      } catch {
        // A missing installation, denied scope or unreachable machine cannot offer the guide.
      }
      if (current && request === revision) setResult({ key, available });
    };
    void refresh();
    window.addEventListener("penguin:workbench-updated", refresh);
    return () => {
      current = false;
      window.removeEventListener("penguin:workbench-updated", refresh);
    };
  }, [project, agent, machine, key]);
  if (!project || !agent || import.meta.env.PUBLIC_PRODUCT_DEMO) return false;
  return result?.key === key ? result.available : null;
}
