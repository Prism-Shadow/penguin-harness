import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { AppWindow } from "@prismshadow/penguin-ui";
import { WorkbenchFrame, WorkbenchTabStrip, useWorkbenchTabs } from "./workbench-tabs";
import type { SessionTabProps } from "../chat";

/** The original main workflow hook and complete JSX, owned by this contributed tab. */
export function WorkbenchSessionTab({
  projectId,
  agentId: pageAgentId,
  machineId,
  windows,
  onWindowShown,
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
  /** A shown workbench tab is the window on screen, and the page hides the Chat window under it. */
  const shown = workflowTabs.activeTab !== null && projectId !== null && pageAgentId !== null;
  const showChat = workflowTabs.setActive;
  useEffect(() => {
    onWindowShown?.(shown ? () => showChat(null) : null);
    return () => onWindowShown?.(null);
  }, [shown, showChat, onWindowShown]);
  return (
    <>
      <WorkbenchTabStrip
        tabs={workflowTabs.tabs}
        notices={workflowTabs.notices}
        active={workflowTabs.active}
        onSelect={workflowTabs.setActive}
      />
      {/* The workbench window: beside Chat in the area under the strip, which it takes whole. */}
      {workflowTabs.activeTab !== null &&
        projectId !== null &&
        pageAgentId !== null &&
        windows !== null &&
        createPortal(
          <AppWindow shown>
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
          </AppWindow>,
          windows,
        )}
    </>
  );
}
