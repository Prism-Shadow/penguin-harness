/**
 * A Detect press that came to nothing, said in a toast — the model dialog's and the group
 * settings dialog's alike. A check the page made before asking (no usable base URL) reads
 * plainly; an endpoint that answered none of the protocols, or a request that failed, is a
 * failure and offers 「[报告问题]」. The probed URLs stay out of the report: they are the
 * person's base URL.
 */
import { toastError } from "@prismshadow/penguin-ui";
import { toldFailure, S, toastApiError, toastFailure } from "@prismshadow/penguin-web/internal";
/** Why the detection came to nothing: a check, no protocol answered, or a failed request. */
export type DetectMiss = "check" | "none" | { error: unknown };

export function toastDetectFailed(miss: DetectMiss): void {
  const text = S.models.detectFailedBody;
  const what = "protocol detection found no protocol the endpoint serves";
  if (miss === "check") toastError(text);
  else if (miss === "none") toastFailure(toldFailure(text, { what, detail: null }));
  else toastApiError(miss.error, { text, what: "protocol detection failed" });
}
