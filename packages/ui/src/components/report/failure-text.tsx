/**
 * A failure's words with 「[报告问题]」 after them when it carries a report (`Failure`); a refusal's
 * words alone. It draws no box and sets no ink: it drops into whatever already says the failure —
 * a danger-ink line, a notice's body, a field's error, an empty state's title — and the action
 * keeps the body ink of every text action, after one space.
 */
import type { ReactNode } from "react";
import type { Failure } from "./failure";
import { ReportIssueAction } from "./report-action";

export function FailureText({ failure }: { failure: Failure }): ReactNode {
  if (failure.report === null) return failure.text;
  return (
    <>
      {failure.text} <ReportIssueAction report={failure.report} />
    </>
  );
}
