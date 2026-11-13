/**
 * An action's failure, said in a toast: the words `apiErrorText` gives the error, and — only when
 * the error is a defect rather than the person's to fix (`isSeriousError`: the server's
 * converged 500, an unnamed 5xx, an exception the app did not expect) — 「[报告问题]」 with its
 * problem report. An expected failure (validation, sign-in, permission, not found, a conflict,
 * the network gone) reads exactly as a plain `toastError` does.
 *
 * The report is built when it is opened, but names the page the failure happened on and when.
 */
import {
  currentReportRoute,
  exceptionReport,
  isSeriousError,
  toastError,
} from "@prismshadow/penguin-ui";
import { apiErrorText } from "./api-error";

export function toastApiError(err: unknown, ctx?: { modelId?: string }): void {
  const text = apiErrorText(err, ctx);
  if (!isSeriousError(err)) {
    toastError(text);
    return;
  }
  const route = currentReportRoute();
  const atMs = Date.now();
  toastError(text, {
    report: () =>
      exceptionReport(err, { what: "an action failed with an unexpected error", route, atMs }),
  });
}
