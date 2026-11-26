/**
 * A failed app's error: what its last load recorded, as the compiler or the loader wrote it. The
 * Agent that owns the app reads the same message from its folder, so the user can hand it over as
 * it is: "Fix with AI" in the footer does that, through the default Agent
 * (features/ai-create/workbench-repair.tsx). 「[报告问题]」 follows the error, since it may come
 * from what the platform provides rather than from the app's code.
 */
import { useMemo } from "react";
import {
  Button,
  GlyphIcon,
  ICONS,
  Modal,
  ReportIssueAction,
  toldReport,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useWorkbenchRepair } from "../ai-create";
import { workbenchLoadFailure } from "../workbenches";

/** The app whose error the dialog shows, and that error. */
export interface BuildError {
  title: string;
  /** The recorded error; undefined when none was recorded. */
  message: string | undefined;
  agentId: string;
  workbenchId: string;
  /** The machine it lives on; null for this server. */
  machineId: string | null;
}

export function BuildErrorDialog({
  error,
  onClose,
}: {
  /** The app and its recorded error; null: closed. */
  error: BuildError | null;
  onClose: () => void;
}) {
  const { repair, modal } = useWorkbenchRepair();
  const message = error?.message;
  const workbenchId = error?.workbenchId ?? null;
  const machineId = error?.machineId ?? null;
  // Made as the dialog opens on an error, so the report keeps the time it was shown.
  const report = useMemo(
    () =>
      workbenchId === null || message === undefined
        ? null
        : toldReport(workbenchLoadFailure({ workbenchId, machineId, error: message })),
    [workbenchId, machineId, message],
  );
  return (
    <>
      <Modal
        open={error !== null}
        title={error === null ? "" : S.appCenter.errorTitle(error.title)}
        onClose={onClose}
        widthClass="sm:max-w-xl"
        footer={
          <>
            {error !== null && message !== undefined && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  repair({
                    workbenchId: error.workbenchId,
                    name: error.title,
                    agentId: error.agentId,
                    machineId: error.machineId,
                    error: message,
                  });
                  onClose();
                }}
              >
                <GlyphIcon d={ICONS.sparkles} />
                {S.plugins.repair}
              </Button>
            )}
            <Button size="sm" onClick={onClose}>
              {S.common.close}
            </Button>
          </>
        }
      >
        {message === undefined ? (
          <p className="text-sm text-fg-muted">{S.appCenter.errorUnknown}</p>
        ) : (
          <>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-fg">
              {message}
            </pre>
            {report !== null && (
              <p className="mt-2 text-sm">
                <ReportIssueAction report={report} />
              </p>
            )}
          </>
        )}
      </Modal>
      {modal}
    </>
  );
}
