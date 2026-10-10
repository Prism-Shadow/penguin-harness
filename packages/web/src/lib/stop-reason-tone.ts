import type { ToneName } from "@prismshadow/penguin-ui";

/**
 * A Task's `stop_reason` as a badge tone. A completed run usually shows no badge at all; an
 * aborted one is unfinished (attention), and anything else — failed, timed out, malformed — is a
 * failure.
 */
export function stopReasonTone(stopReason: string): ToneName {
  switch (stopReason) {
    case "completed":
      return "success";
    case "aborted":
      return "attention";
    default:
      return "danger";
  }
}
