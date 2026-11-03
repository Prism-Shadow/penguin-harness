/**
 * 「[报告问题]」: the bracketed text action that opens a problem report, set after whatever said
 * something went wrong — a toast, a load-failure notice, a crash notice. It is offered only for a
 * serious error (`isSeriousError`); the caller decides that and passes the report, or a function
 * that builds it when pressed (a report reads the page and the time at that moment).
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
