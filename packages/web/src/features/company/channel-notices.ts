/**
 * A channel's `system` lines in the reader's language (pure, unit tested).
 *
 * The server records each such line twice: as the English sentence in `text`, which the day
 * file itself and the CLI read, and as a structured `notice` — the kind of the event and its
 * parameters. This module turns the notice into the sentence, with employees under their
 * display names rather than spelled `agent:<id>`. A line carrying no notice (one written
 * before the field existed) or one of a kind this build does not know (a newer server) has no
 * localized sentence, and the view falls back to the English `text` it always had.
 *
 * The parameter names are the contract's, not this module's invention: principals arrive as
 * `agent` / `principal` / `by` / `reportsTo`, a ticket as `ticket` + `title` (which an
 * employee's job title reuses), a budget event as `agent`, `period`, `percent`, `cost` and
 * `budget`. A parameter the server omitted renders as an empty string rather than throwing —
 * a malformed notice must not take the stream down with it.
 */
import type { OrgChannelNotice, OrgChannelNoticeKind } from "@prismshadow/penguin-server/api";
import type { Strings } from "../../lib/strings";
import { parsePrincipal } from "./principals";

/** The sentences, one function per kind — `S.company.channels.notices`. */
export type NoticeStrings = Strings["company"]["channels"]["notices"];

/**
 * Every kind as a value, for the test that checks both dictionaries carry a function for each.
 * The `satisfies` is what keeps it honest: a kind added to the contract stops compiling here
 * until it is listed, and a kind that no longer exists stops compiling too.
 */
export const NOTICE_KINDS = Object.keys({
  employee_joined: true,
  employee_left: true,
  channel_created: true,
  channel_archived: true,
  channel_unarchived: true,
  channel_joined: true,
  channel_invited: true,
  channel_left: true,
  channel_removed: true,
  budget_warned: true,
  budget_paused: true,
  ticket_blocked: true,
  ticket_done: true,
  ticket_rejected: true,
} satisfies Record<OrgChannelNoticeKind, true>) as OrgChannelNoticeKind[];

/** How a principal in a notice reads: an employee's name, a member's user id, anything else as written. */
export function noticePrincipalName(raw: string, names: ReadonlyMap<string, string>): string {
  const p = parsePrincipal(raw);
  if (p.kind === "agent") return names.get(p.id) ?? p.id;
  if (p.kind === "user") return p.id;
  return raw;
}

/**
 * The notice as one sentence, or null when this build has no wording for its kind — the
 * caller then shows the server's English `text`.
 */
export function noticeText(
  notice: OrgChannelNotice,
  names: ReadonlyMap<string, string>,
  notices: NoticeStrings,
): string | null {
  const params = notice.params;
  const value = (key: string): string => params[key] ?? "";
  const who = (key: string): string => noticePrincipalName(value(key), names);
  const budget = (
    line: (a: string, percent: string, period: string, cost: string, budget: string) => string,
  ): string =>
    line(who("agent"), value("percent"), value("period"), value("cost"), value("budget"));
  const ticket = (line: (id: string, title: string) => string): string =>
    line(value("ticket"), value("title"));
  switch (notice.kind) {
    case "employee_joined":
      return notices.employee_joined(who("agent"), value("title"), who("reportsTo"));
    case "employee_left":
      return notices.employee_left(who("agent"), who("reportsTo"));
    case "channel_created":
      return notices.channel_created(who("by"));
    case "channel_archived":
      return notices.channel_archived(who("by"));
    case "channel_unarchived":
      return notices.channel_unarchived(who("by"));
    case "channel_joined":
      return notices.channel_joined(who("principal"));
    case "channel_invited":
      return notices.channel_invited(who("by"), who("principal"));
    case "channel_left":
      return notices.channel_left(who("principal"));
    case "channel_removed":
      return notices.channel_removed(who("by"), who("principal"));
    case "budget_warned":
      return budget(notices.budget_warned);
    case "budget_paused":
      return budget(notices.budget_paused);
    case "ticket_blocked":
      return ticket(notices.ticket_blocked);
    case "ticket_done":
      return ticket(notices.ticket_done);
    case "ticket_rejected":
      return ticket(notices.ticket_rejected);
    default:
      return null;
  }
}
