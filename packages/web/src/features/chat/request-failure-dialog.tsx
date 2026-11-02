/**
 * The details of a failed model request — what 「[详情]」 on its line in the conversation opens:
 * the report (request-failure-report.ts) as it would be shared, a press to copy it, and a link to
 * the project's bug form on GitHub, prefilled with it.
 *
 * The report's environment comes from what the app already reads: the version report the sidebar
 * footer and Settings show (`useVersionInfo`) for the version and how it is installed — a source
 * build says so, otherwise the desktop shell's server or a server started by hand — and the OS
 * of the machine the Session runs on: this server's own, or, for a Session on another machine,
 * that machine's version report, asked for when the dialog opens. A fact that has not arrived is
 * left out of the report until it does.
 *
 * The link opens in a new tab; in the desktop app the shell hands any page outside the app to
 * the system browser, so it lands there.
 */
import { useEffect, useState } from "react";
import {
  Button,
  ReportDialog,
  buttonClass,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { VersionResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { writeClipboard } from "../../lib/clipboard";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { useVersionInfo } from "../../lib/use-version-info";
import { useAuth } from "../../state/auth";
import { installKindOf, osName, requestFailureReport } from "./request-failure-report";
import type { RequestFailure, ReportEnvironment } from "./request-failure-report";

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
  const { version } = useVersionInfo(true);
  const { desktopMode } = useAuth();
  const machine = sessionId === null ? null : machineForSession(sessionId);
  const remote = useMachineVersion(failure === null ? null : machine);
  if (failure === null) return null;

  const env: ReportEnvironment = {
    version: version?.describe ?? null,
    install: version === null ? null : installKindOf({ channel: version.channel, desktopMode }),
    os:
      machine === null
        ? version === null
          ? null
          : osName(version.runtime)
        : remote === null
          ? null
          : osName(remote.runtime),
    remote: machine === null ? null : { version: remote?.describe ?? null },
    workspace,
  };
  const model = failure.model ?? sessionModel;
  const report = requestFailureReport(model === null ? failure : { ...failure, model }, env);
  const t = S.chat.failureReport;
  const copy = () => {
    void writeClipboard(report.markdown).then((ok) =>
      ok ? toastSuccess(t.copied) : toastError(t.copyFailed),
    );
  };
  return (
    <ReportDialog
      open
      onClose={onClose}
      title={t.title}
      description={
        <>
          <p>{t.lead}</p>
          <p>{t.check}</p>
        </>
      }
      report={report.markdown}
      reportLabel={t.reportLabel}
      actions={
        <>
          <Button size="sm" onClick={copy}>
            {t.copy}
          </Button>
          <a
            href={report.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-file-issue=""
            className={buttonClass("primary", "sm")}
          >
            {t.fileIssue}
          </a>
        </>
      }
    />
  );
}
