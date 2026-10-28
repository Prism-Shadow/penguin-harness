import type { ToneName } from "@prismshadow/penguin-ui";

/**
 * A record's `status` (a request's end, a tool result, a compaction or MCP connect end) as a
 * badge tone. A completed one usually shows no badge at all; an aborted one is unfinished
 * (attention), and anything else — fatal, retryable — is a failure.
 */
export function statusTone(status: string): ToneName {
  switch (status) {
    case "completed":
      return "success";
    case "aborted":
      return "attention";
    default:
      return "danger";
  }
}
