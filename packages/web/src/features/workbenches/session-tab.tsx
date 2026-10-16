import { useLocation } from "react-router";
import { WorkbenchFrame, WorkbenchTabStrip, useWorkbenchTabs } from "./workbench-tabs";
import type { SessionTabProps } from "../chat";

/** The original main workflow hook and complete JSX, owned by this contributed tab. */
export function WorkbenchSessionTab({
  projectId,
  agentId: pageAgentId,
  machineId,
}: SessionTabProps) {
  const location = useLocation();
  const returnWorkbench = (
    location.state as {
      workbench?: { projectId: string; agentId: string; tabId: string; machineId: string | null };
    } | null
  )?.workbench;
  const workflowTabs = useWorkbenchTabs(
    projectId,
    pageAgentId,
    machineId,
    location.key,
    returnWorkbench?.projectId === projectId &&
      returnWorkbench.agentId === pageAgentId &&
      returnWorkbench.machineId === machineId
      ? returnWorkbench.tabId
      : null,
  );
  return (
    <>
      <WorkbenchTabStrip
        tabs={workflowTabs.tabs}
        notices={workflowTabs.notices}
        active={workflowTabs.active}
        onSelect={workflowTabs.setActive}
      />
      {workflowTabs.activeTab !== null && projectId !== null && pageAgentId !== null && (
        <div className="absolute inset-x-0 bottom-0 top-9 z-10">
          <WorkbenchFrame
            // Per tab: the frame keeps this workflow's history fold, its error and its
            // armed Remove, and none of that belongs to the next tab.
            key={workflowTabs.activeTab.tabId}
            projectId={projectId}
            agentId={pageAgentId}
            tab={workflowTabs.activeTab}
            onChanged={() => void workflowTabs.refresh()}
            onRemoved={() => {
              workflowTabs.setActive(null);
              void workflowTabs.refresh();
            }}
          />
        </div>
      )}
    </>
  );
}
