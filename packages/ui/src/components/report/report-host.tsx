/**
 * The problem report on screen: `ErrorReportDialog` shows one report as it would be shared — the
 * report built in the host's environment, Copy, and the link to the prefilled bug form — and
 * `ReportHost`, mounted once beside the toasts, shows whichever report was opened from anywhere
 * (`openReport`).
 *
 * The dialog's title and lead are the shared ones unless the report brings its own (a provider's
 * failure says most such failures are the provider's). Copy writes the report as Markdown through
 * the app's clipboard writer and says whether it landed. The link opens in a new tab; a desktop
 * shell hands a page outside the app to the system browser.
 */
import { useStore } from "zustand/react";
import { Button, buttonClass } from "../actions/button/button";
import { useClipboardWriter } from "../actions/copy-button/copy-button";
import { ReportDialog } from "../overlays/report-dialog/report-dialog";
import { toastError, toastSuccess } from "../overlays/toaster/toaster";
import { useUiStrings } from "../../strings";
import { buildReport } from "./error-report";
import type { ErrorReport } from "./error-report";
import { closeReport, reportStore } from "./report-store";

export function ErrorReportDialog({
  report,
  onClose,
}: {
  /** The report on show; null while closed. */
  report: ErrorReport | null;
  onClose: () => void;
}) {
  const strings = useUiStrings().report;
  const write = useClipboardWriter();
  const environment = useStore(reportStore, (s) => s.environment);
  if (report === null) return null;
  const built = buildReport(report, environment);
  const copy = () => {
    void write(built.markdown).then((ok) =>
      ok ? toastSuccess(strings.copied) : toastError(strings.copyFailed),
    );
  };
  return (
    <ReportDialog
      open
      onClose={onClose}
      title={report.dialog?.title ?? strings.title}
      description={
        report.dialog?.lead ?? (
          <>
            <p>{strings.lead}</p>
            <p>{strings.check}</p>
          </>
        )
      }
      report={built.markdown}
      reportLabel={strings.label}
      actions={
        <>
          <Button size="sm" onClick={copy}>
            {strings.copy}
          </Button>
          <a
            href={built.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-file-issue=""
            className={buttonClass("primary", "sm")}
          >
            {strings.fileIssue}
          </a>
        </>
      }
    />
  );
}

/** The report opened from anywhere: mount once, beside the toasts. */
export function ReportHost() {
  const open = useStore(reportStore, (s) => s.open);
  return <ErrorReportDialog report={open} onClose={closeReport} />;
}
