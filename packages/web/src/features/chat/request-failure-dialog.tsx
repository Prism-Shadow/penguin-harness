/**
 * The details of a failed model request — what 「[详情]」 on its line in the conversation opens:
 * the UI package's report dialog (`ErrorReportDialog`) for the request's report
 * (request-failure-report.ts), with Copy and the link to the prefilled bug form.
 *
 * The version and how PenguinHarness is installed are the app's own (the report store's
 * environment, set at the app's root). The OS is the machine's the Session runs on: this
 * server's, or, for a Session on another machine, that machine's version report, asked for when
 * the dialog opens; until it answers the report goes without it.
 *
 * Its title and lead are the chat's own: most such failures are the provider's or the network's,
 * which the kit's shared lead (an error like this is likely a defect) would misstate.
 */
import { useEffect, useState } from "react";
import { ErrorReportDialog, osName } from "@prismshadow/penguin-ui";
import type { VersionResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { requestFailureReport } from "./request-failure-report";
import type { RequestFailure } from "./request-failure-report";

/** The version report of the machine a Session runs on, asked for while `machine` is set. */
function useMachineVersion(machine: string | null): VersionResponse | null {
  const [answer, setAnswer] = useState<{ machine: string; report: VersionResponse } | null>(null);
  useEffect(() => {
    if (machine === null) return;
    let live = true;
    api.getVersion(machine).then(
      (report) => {
        if (live) setAnswer({ machine, report });
      },
      // Out of reach: the report goes without that machine's OS.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [machine]);
  return answer !== null && answer.machine === machine ? answer.report : null;
}

export function RequestFailureDialog({
  failure,
  sessionId,
  sessionModel,
  workspace,
  onClose,
}: {
  /** The failure on show; null while the dialog is closed. */
  failure: RequestFailure | null;
  /** The conversation's Session: the machine it runs on is the one whose OS the report names. */
  sessionId: string | null;
  /** The Session's model, for a failure whose records did not say which. */
  sessionModel: { provider: string; modelId: string } | null;
  /** The Session's Workspace path, kept out of the report. */
  workspace: string | null;
  onClose: () => void;
}) {
  const machine = sessionId === null ? null : machineForSession(sessionId);
  const remote = useMachineVersion(failure === null ? null : machine);
  const t = S.chat.failureReport;
  const model = failure?.model ?? sessionModel;
  const report =
    failure === null
      ? null
      : requestFailureReport(model === null ? failure : { ...failure, model }, {
          workspace,
          remote:
            machine === null
              ? null
              : {
                  os: remote === null ? null : osName(remote.runtime),
                  version: remote?.describe ?? null,
                },
          dialog: {
            title: t.title,
            lead: (
              <>
                <p>{t.lead}</p>
                <p>{t.check}</p>
              </>
            ),
          },
        });
  return <ErrorReportDialog report={report} onClose={onClose} />;
}
