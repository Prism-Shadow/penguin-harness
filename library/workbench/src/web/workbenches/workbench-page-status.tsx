/**
 * What an app's pane shows while it has no page to draw, in the window and on the full page:
 * that it is opening, why its Agent's list could not be read, that the workbench is switched off,
 * or that it has no page. A workbench that is listed but drew nothing says why (its load error,
 * when it has one) and offers Reload on the spot, since nothing else in the pane can.
 *
 * A load error is a failure the app was told about: 「[报告问题]」 follows its words, since the
 * error may come from what the platform provides rather than from the workbench's code. Beside
 * Reload stands what the caller hands in for it: the window's "Fix with AI", which gives the error
 * and the folder to the default Agent (features/ai-create/workbench-repair.tsx). The full page has
 * none — it sits outside the shell, with no Project to open a chat in.
 */
import { useMemo, type ReactNode } from "react";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { Button, FailureText } from "@prismshadow/penguin-ui";
import { toldFailure, S } from "@prismshadow/penguin-web/internal";
import { useWorkbenchActions } from "./workbench-actions";
import { workbenchLoadFailure, type FailedWorkbench } from "./workbench-load-failure";

export function WorkbenchPageStatus({
  projectId,
  agentId,
  machineId,
  workbench,
  loading,
  off,
  failure,
  repair,
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
  /** What stands beside Reload while the files do not load; absent, nothing does. */
  repair?: ((workbench: FailedWorkbench) => ReactNode) | undefined;
  /** A line under the state: the full page's way out. */
  children?: ReactNode;
}) {
  const { reload, busy } = useWorkbenchActions({ projectId, agentId, machineId });
  /** The files' own load error: named as a failure, then given as the compiler wrote it. */
  const loadError = !loading && failure === null && !off ? (workbench?.error ?? null) : null;
  const workbenchId = workbench?.id ?? null;
  // Made when the error is first shown, so its report keeps that time across renders.
  const loadFailure = useMemo(
    () =>
      loadError === null || workbenchId === null
        ? null
        : toldFailure(
            loadError,
            workbenchLoadFailure({ workbenchId, machineId, error: loadError }),
          ),
    [loadError, workbenchId, machineId],
  );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
      {loadError !== null && workbench !== null && (
        <p className="font-medium text-fg">{S.appCenter.errorTitle(workbench.name)}</p>
      )}
      <p role="status" className="max-w-prose whitespace-pre-wrap break-words">
        {loading
          ? S.workbenches.loadingPage
          : (failure ??
            (off ? (
              S.workbenches.offPage
            ) : loadFailure !== null ? (
              <FailureText failure={loadFailure} />
            ) : (
              S.workbenches.noSuchPage
            )))}
      </p>
      {!loading && !off && workbench !== null && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => reload(workbench)}>
            {S.workbenches.reload}
          </Button>
          {loadError !== null &&
            repair?.({
              workbenchId: workbench.id,
              name: workbench.name,
              agentId,
              machineId,
              error: loadError,
            })}
        </div>
      )}
      {children}
    </div>
  );
}
