/**
 * The one-line summary of an `[org_trigger]` block (pure, unit tested): what the organization
 * scheduler sent a desk or ticket session, reduced to the trigger's kind, the one fact that
 * identifies it (the event, the chat message, the ticket and its change) and the budget line
 * the scheduler wrote. The banner (org-trigger-banner.tsx) only localizes these.
 */
import type { OrgTriggerOrigin } from "@prismshadow/penguin-core/markers";

export { parseOrgTriggerMessage } from "@prismshadow/penguin-core/markers";
export type { OrgTriggerKind, OrgTriggerOrigin } from "@prismshadow/penguin-core/markers";

export interface OrgTriggerSummary {
  org: string;
  kind: OrgTriggerOrigin["kind"];
  /** The employee's agent id — the block writes `<id>` or `<id> (<title>, reports to <id>)`. */
  agentId: string;
  /** The kind-specific identifier: the event name, the message reference, the ticket id — null for `init`. */
  subject: string | null;
  /** A ticket notice's change (`assigned`, `blocked`, …); null otherwise. */
  change: string | null;
  /** The event's fire time (ISO 8601), for the event kind only. */
  firedAt: string | null;
  budget: string | null;
}

/** The agent id in front of an employee line's optional parenthesis. */
export function orgTriggerAgentId(employee: string): string {
  const at = employee.indexOf(" (");
  return (at === -1 ? employee : employee.slice(0, at)).trim();
}

export function summarizeOrgTrigger(origin: OrgTriggerOrigin): OrgTriggerSummary {
  const subject =
    origin.kind === "event"
      ? (origin.event ?? null)
      : origin.kind === "mention"
        ? (origin.message ?? null)
        : origin.kind === "ticket_notice" || origin.kind === "ticket_work"
          ? (origin.ticket ?? null)
          : null;
  return {
    org: origin.org,
    kind: origin.kind,
    agentId: orgTriggerAgentId(origin.employee),
    subject,
    change: origin.kind === "ticket_notice" ? (origin.change ?? null) : null,
    firedAt: origin.kind === "event" ? (origin.firedAt ?? null) : null,
    budget: origin.budget ?? null,
  };
}
