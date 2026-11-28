/** A ticket is an ASCII id followed by `.md` in a single filename component. */
export const TICKET_ID_MAX_LENGTH = 255 - ".md".length;

export const TICKET_SLUG_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;
const TICKET_ID_PATTERN = /^(?:ticket-)?\d{4}-\d{2}-\d{2}-[a-z]+(?:-[a-z]+)*$/;

export function isTicketId(value: string): boolean {
  return value.length <= TICKET_ID_MAX_LENGTH && TICKET_ID_PATTERN.test(value);
}

/** The filing day in the organization timezone, as encoded in the ticket's filename. */
export function ticketCreatedDate(ticketId: string): string | null {
  return /^(?:ticket-)?(\d{4}-\d{2}-\d{2})-/.exec(ticketId)?.[1] ?? null;
}
