/**
 * The drawer's shaping of what hangs off a ticket (pure, unit tested): the operation history
 * the ticket's frontmatter carries — newest first, and as a bare `time · principal · action`
 * line, because what an action wrote is already the section it wrote into — and the counts
 * the two folded lists report from their closed headers.
 */
import type {
  OrgTicketDetail,
  OrgTicketHistoryAction,
  OrgTicketHistoryEntry,
} from "@prismshadow/penguin-server/api";

export interface TicketHistoryRow {
  /** Stable across refetches: the entries themselves carry no id. */
  key: string;
  at: string;
  by: string;
  action: OrgTicketHistoryAction;
}

/**
 * The history as the drawer lists it: newest first, and only what happened — an entry's
 * `note` is left unread, so the history stays a log of operations rather than a second copy
 * of the progress, the block reason and the fields an edit touched.
 */
export function ticketHistoryRows(history: readonly OrgTicketHistoryEntry[]): TicketHistoryRow[] {
  return history
    .map((entry, i) => ({
      key: `${i}-${entry.at}-${entry.action}`,
      at: entry.at,
      by: entry.by,
      action: entry.action,
    }))
    .reverse();
}

export interface TicketSummaryCounts {
  children: number;
  sessions: number;
  /** Per list: an empty one still shows its fold, with "none" where the count would be. */
  childrenEmpty: boolean;
  sessionsEmpty: boolean;
}

/** What each folded list's header counts: the child tickets, and the ticket's own sessions. */
export function ticketSummaryCounts(
  detail: Pick<OrgTicketDetail, "children" | "sessionItems">,
): TicketSummaryCounts {
  const children = detail.children.length;
  const sessions = detail.sessionItems.length;
  return { children, sessions, childrenEmpty: children === 0, sessionsEmpty: sessions === 0 };
}
