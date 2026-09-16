/**
 * The "Since your last sweep" section of a calendar event's body. Ticket changes never wake
 * a desk: an owner assigned, a ticket blocked, a blocker closed, done, rejected — each is
 * queued for the employee and listed here when its next calendar event fires, which is where
 * it decides what to do about each. Pure: the rows as they were queued and the tickets as
 * they stand now go in, one Markdown section comes out.
 */
import type { OrgTicketChange } from "../../api/types.js";
import type { OrgDeskNoticeRow } from "../../db/repos/organizations.js";
import type { TicketDoc } from "../../organization/files.js";

/** A ticket as the digest reads it: the listing the reconcile pass already holds. */
export interface DigestTicket {
  ticketId: string;
  doc: TicketDoc;
}

/** What each change is called, before the ticket's own reason or blocker is added. */
const CHANGE_LABEL: Record<OrgTicketChange, string> = {
  assigned: "assigned to you",
  blocked: "blocked",
  blocker_closed: "blocker closed",
  done: "done",
  rejected: "rejected",
};

/** The title of a ticket whose file is gone by the time the sweep fires. */
const REMOVED_TITLE = "ticket removed";

const MAX_REASON = 120;

/** The first line of a reason, short enough to sit inside a list item. */
function shortReason(text: string | undefined): string | null {
  const line = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (line === undefined) return null;
  return line.length > MAX_REASON ? `${line.slice(0, MAX_REASON - 1)}…` : line;
}

/** The change, plus what the ticket itself says about it: the reason, the blocker, the next step. */
function changeText(row: OrgDeskNoticeRow, doc: TicketDoc | null): string {
  const label = CHANGE_LABEL[row.change];
  if (doc === null) return label;
  const blockedBy = doc.blockedBy !== undefined && doc.blockedBy !== "" ? doc.blockedBy : null;
  switch (row.change) {
    case "blocked": {
      const reason = shortReason(doc.blocked);
      const by = blockedBy === null ? "" : ` (by ${blockedBy})`;
      return `${label}${reason === null ? "" : ` — "${reason}"`}${by}`;
    }
    case "blocker_closed": {
      const which = blockedBy === null ? "" : ` (${blockedBy})`;
      return `${label}${which} — verify, then \`penguin org ticket unblock ${row.ticketId}\``;
    }
    case "rejected": {
      // A rejection's reason is appended to the ticket's `## Result` by the move that made it.
      const reason = shortReason(doc.result);
      return reason === null ? label : `${label} — "${reason}"`;
    }
    default:
      return label;
  }
}

/**
 * The queued changes as the section a calendar event's body ends with, or `""` when nothing
 * is queued. One line per row in queue order, each naming the ticket, its current title and
 * what happened to it.
 */
export function deskDigest(
  rows: readonly OrgDeskNoticeRow[],
  tickets: readonly DigestTicket[],
): string {
  if (rows.length === 0) return "";
  const byId = new Map(tickets.map((t) => [t.ticketId, t.doc]));
  const lines = rows.map((row) => {
    const doc = byId.get(row.ticketId) ?? null;
    const title = doc === null ? REMOVED_TITLE : doc.title;
    return `- ${row.ticketId} (${title}): ${changeText(row, doc)}`;
  });
  return [
    "## Since your last sweep",
    ...lines,
    "",
    'Decide on each: start a ticket session (`penguin org ticket start <id> -m "…"`), verify and unblock, or leave it — do not do the work at your desk.',
  ].join("\n");
}
