/**
 * A failure said in a toast: its words and, for every failure but a refusal, 「[报告问题]」 with
 * its problem report (lib/failure.tsx). A refusal (validation, sign-in, permission, not found, a
 * conflict, a limit) reads exactly as a plain `toastError` does; `toastError(text)` itself is for
 * a check the page made before any request.
 */
import { toastError } from "@prismshadow/penguin-ui";
import type { Failure } from "@prismshadow/penguin-ui";
import { failureOf } from "./failure";
import type { FailureContext } from "./failure";

export function toastApiError(err: unknown, ctx?: FailureContext): void {
  toastFailure(failureOf(err, ctx));
}

export function toastFailure(failure: Failure): void {
  toastError(failure.text, failure.report === null ? undefined : { report: failure.report });
}
