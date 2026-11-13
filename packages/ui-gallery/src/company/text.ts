/**
 * A ticket's words, read from the dictionary by what the ticket holds. A sample ticket shows its
 * fixture's words; one the reader asked for shows their own sentence and a few generic lines.
 */
import type { Ticket } from "./model";
import type { TicketWords, Words } from "./words";

const sample = (ticket: Ticket, W: Words): TicketWords | null =>
  ticket.fixture === null ? null : W.tickets[ticket.fixture];

export const titleOf = (ticket: Ticket, W: Words): string =>
  sample(ticket, W)?.title ?? ticket.title ?? "";

export const gistOf = (ticket: Ticket, W: Words): string =>
  sample(ticket, W)?.gist ?? W.ticket.saidGoal;

export const acceptanceOf = (ticket: Ticket, W: Words): readonly string[] =>
  sample(ticket, W)?.acceptance ?? [];

export const questionOf = (ticket: Ticket, W: Words): string => sample(ticket, W)?.question ?? "";

export const optionsOf = (ticket: Ticket, W: Words): readonly { label: string; hint: string }[] =>
  sample(ticket, W)?.options ?? [];

export const resultOf = (ticket: Ticket, W: Words): string =>
  sample(ticket, W)?.result ?? W.ticket.saidResult;

/** The progress lines it holds: its own first, then one line for each round of rework. */
export function progressOf(ticket: Ticket, W: Words): string[] {
  const own = sample(ticket, W)?.progress ?? [W.ticket.saidProgress];
  return Array.from({ length: ticket.progress }, (_, i) => own[i] ?? W.ticket.reworkProgress);
}

/** A send-back note: the reader's own, or for a staged one, the sample's. */
export const returnOf = (ticket: Ticket, note: string, W: Words): string =>
  note !== "" ? note : (sample(ticket, W)?.returned ?? "");

/** The one line the inbox shows under a title: what it asks, what it delivered, or what it is. */
export function lineOf(ticket: Ticket, W: Words): string {
  if (ticket.asked) return questionOf(ticket, W);
  if (ticket.delivered) return resultOf(ticket, W);
  return gistOf(ticket, W);
}
