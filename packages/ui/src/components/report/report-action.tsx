/**
 * 「[报告问题]」: the bracketed text action that opens a problem report, set in the danger ink after
 * whatever said something failed — a toast, a load-failure notice, an inline failure, a crash
 * notice. It is offered for every failure and never for a refusal (`isReportable`); the caller
 * decides that and passes the report, or a function that builds it when pressed.
 */
import { TextAction } from "../actions/text-action/text-action";
import { useUiStrings } from "../../strings";
import type { ErrorReport } from "./error-report";
import { openReport } from "./report-store";

export interface ReportIssueActionProps {
  report: ErrorReport | (() => ErrorReport);
  /** Called as the report opens (a toast dismisses itself). */
  onOpen?: () => void;
  className?: string;
}

export function ReportIssueAction({ report, onOpen, className }: ReportIssueActionProps) {
  const strings = useUiStrings().report;
  return (
    <TextAction
      tone="danger"
      data-report-issue=""
      {...(className !== undefined ? { className } : {})}
      onClick={() => {
        openReport(typeof report === "function" ? report() : report);
        onOpen?.();
      }}
    >
      {strings.action}
    </TextAction>
  );
}
