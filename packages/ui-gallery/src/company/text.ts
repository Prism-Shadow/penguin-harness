/** How the prototype names a ticket and sums it up in a line, in the reader's language. */
import { FIXTURES } from "./fixtures";
import { ticketWait } from "./model";
import type { Entry, Ticket } from "./model";
import type { Words } from "./words";

export function titleOf(ticket: Ticket, W: Words): string {
  return ticket.text ?? W.tickets[ticket.fixture].title;
}

/** The line under a ticket's title in the inbox: what it waits on, or how far it has got. */
export function lineOf(ticket: Ticket, W: Words): string {
  const wait = ticketWait(ticket);
  if (wait === "ask") return W.tickets[ticket.fixture].ask?.question ?? W.waits.ask;
  if (wait === "halt") {
    return ticket.halt === "budget"
      ? `${W.needs.haltBudgetTitle} · ${W.ticket.spentOf(W.money(ticket.spent), W.money(ticket.budget))}`
      : `${W.needs.haltRoundsTitle} · ${W.ticket.roundsOf(ticket.rounds.used, ticket.rounds.limit)}`;
  }
  if (wait === "decide") {
    const action = ticket.outward === null ? null : W.outward.actions[ticket.outward];
    return action === null ? W.workbench.verifiedBy : `${W.workbench.verifiedBy} · ${action}`;
  }
  if (wait === "accept") return W.sources[ticket.source];
  if (ticket.status === "dropped") return W.statuses.dropped;
  if (ticket.status === "done") return W.statuses.done;
  const returned = ticket.review.length;
  const where = W.statuses[ticket.status];
  return returned > 0
    ? `${where} · ${W.ticket.returned(returned)}`
    : `${where} · ${W.sources[ticket.source]}`;
}

/** What a handbook entry says, and the ticket it came from. */
export function entryText(entry: Entry, tickets: readonly Ticket[], W: Words): string {
  const ticket = tickets.find((candidate) => candidate.id === entry.ticket);
  const fixture =
    ticket?.fixture ?? (entry.ticket in FIXTURES ? (entry.ticket as keyof typeof FIXTURES) : null);
  if (fixture === null) return "";
  const words = W.tickets[fixture];
  if (entry.kind === "decision") {
    const option = words.ask?.options[entry.option]?.label;
    const said = option ?? words.ruled ?? entry.option;
    return entry.note === "" ? said : `${said}${W.colon}${entry.note}`;
  }
  if (entry.kind === "change") return words.title;
  const review = entry.review;
  return review.by === "person" ? review.text : (words.lessons?.[review.finding] ?? "");
}
