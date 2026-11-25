/**
 * What an app's pane shows while it has no page to draw, in the window and on the full page:
 * that it is opening, why its Agent's list could not be read, that the workbench is switched off,
 * or that it has no page. A workbench that is listed but drew nothing says why (its load error,
 * when it has one) and offers Reload on the spot, since nothing else in the pane can.
 */
import type { ReactNode } from "react";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { Button } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useWorkbenchActions } from "./workbench-actions";

export function WorkbenchPageStatus({
  projectId,
  agentId,
  machineId,
  workbench,
  loading,
  off,
  failure,
  children,
}: {
  projectId: string;
  agentId: string;
  machineId: string | null;
  /** The workbench as last listed; null until then, or when the list lacks it. */
  workbench: WorkbenchInfo | null;
  /** No answer yet. */
  loading: boolean;
  /** Listed, but switched off. */
  off: boolean;
  /** Why the list could not be read. */
  failure: ReactNode;
  /** A line under the state: the full page's way out. */
  children?: ReactNode;
}) {
  const { reload, busy } = useWorkbenchActions({ projectId, agentId, machineId });
  /** The files' own load error: named as a failure, then given as the compiler wrote it. */
  const loadError = !loading && failure === null && !off ? (workbench?.error ?? null) : null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
      {loadError !== null && workbench !== null && (
        <p className="font-medium text-fg">{S.appCenter.errorTitle(workbench.name)}</p>
      )}
      <p role="status" className="max-w-prose whitespace-pre-wrap break-words">
        {loading
          ? S.workbenches.loadingPage
          : (failure ?? (off ? S.workbenches.offPage : (loadError ?? S.workbenches.noSuchPage)))}
      </p>
      {!loading && !off && workbench !== null && (
        <Button size="sm" disabled={busy} onClick={() => reload(workbench)}>
          {S.workbenches.reload}
        </Button>
      )}
      {children}
    </div>
  );
}
