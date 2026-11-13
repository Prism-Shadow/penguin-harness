/**
 * The vocabulary of the proposed company mode, in one place: the prototype (this directory) acts
 * on it, and the landing's /company page tables it under the prototype. It is a proposal: `isNew`
 * marks what the shipped company mode does not have yet. Nothing here is language; the words are
 * in the dictionaries of whoever shows an entry.
 *
 * A ticket keeps the shipped file (`tickets/<yyyy-mm>/<status>/<yyyy-mm-dd>-<slug>.md`) and its
 * five statuses. "Waiting on a person" is not a sixth status: it is read from the three states in
 * which a ticket already cannot move without one (`waitOf`). A person's own handling of a ticket
 * (read, later, archived) is kept apart from the file and decides only where the inbox lists it.
 */

export const TICKET_STATUSES = ["proposed", "in_progress", "review", "done", "rejected"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Why a ticket waits on a person: to be accepted, to have its one question answered, to be reviewed. */
export type Wait = "accept" | "answer" | "review";

/** The part of a ticket the waiting rule and the inbox read. */
export interface TicketState {
  status: TicketStatus;
  /** `agent:<id>`, `user:<id>` or a ticket id; a `user:` principal is a person. */
  blockedBy?: string;
}

const isPerson = (principal: string | undefined) => principal?.startsWith("user:") === true;

/** The reason a ticket waits on a person, or null while it does not. */
export function waitOf(ticket: TicketState): Wait | null {
  if (ticket.status === "proposed") return "accept";
  if (ticket.status === "review") return "review";
  if (ticket.status === "in_progress" && isPerson(ticket.blockedBy)) return "answer";
  return null;
}

/** The inbox's views, in the order its filter shows them. */
export const INBOX_VIEWS = ["waiting", "working", "later", "handled", "archived"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** The part of a ticket the inbox reads besides its state: the reader's own triage. */
export interface Triage {
  snoozed: boolean;
  archived: boolean;
}

/**
 * The one view a ticket is listed in. Triage comes first, since it is the reader's own word on
 * the ticket: an archived ticket is nowhere else, a snoozed one only under "later". Then what
 * waits on the reader, what an agent has, and what is settled.
 */
export function inboxViewOf(ticket: TicketState & Triage): InboxView {
  if (ticket.archived) return "archived";
  if (ticket.snoozed) return "later";
  if (waitOf(ticket) !== null) return "waiting";
  return ticket.status === "in_progress" ? "working" : "handled";
}

/** Who writes a field: a person, an agent through `penguin org`, or the server as a fact. */
export type Writer = "person" | "agent" | "server";

export interface FieldDoc<Path extends string = string> {
  /** The key in the ticket's frontmatter, a `## ` section, or a per-person triage column. */
  path: Path;
  type: string;
  required: boolean;
  writers: readonly Writer[];
  /** Not in the shipped ticket file. */
  isNew: boolean;
}

const field = <Path extends string>(
  path: Path,
  type: string,
  writers: readonly Writer[],
  options: { required?: boolean; isNew?: boolean } = {},
): FieldDoc<Path> => ({
  path,
  type,
  writers,
  required: options.required ?? false,
  isNew: options.isNew ?? false,
});

/** The ticket file's frontmatter, in the order the file writes it. */
export const FRONTMATTER_FIELDS = [
  field("title", "string", ["person", "agent"], { required: true }),
  field("status", TICKET_STATUSES.join(" | "), ["person", "agent"], { required: true }),
  field("owner", "agent:<id> | user:<id>", ["person", "agent"], { required: true }),
  field("verifier", "agent:<id>", ["person", "agent"], { isNew: true }),
  field("source", "user:<id> | schedule:<event> | agent:<id>", ["server"], {
    required: true,
    isNew: true,
  }),
  field("parent", "ticket id", ["person", "agent"]),
  field("notify", "principal[]", ["person", "agent"], { required: true }),
  field("priority", "P0 | P1 | P2", ["person", "agent"], { required: true }),
  field("due", "date", ["person", "agent"]),
  field("blocked", "string", ["person", "agent"]),
  field("blocked_by", "ticket id | principal", ["person", "agent"]),
  field("ask", "{ question, options[], recommended }", ["agent"], { isNew: true }),
  field("deliverables", "string[]", ["agent"], { isNew: true }),
  field("sessions", "{ id, by, as: build | verify }[]", ["server"], { required: true }),
  field("history", "{ at, by, action, note? }[]", ["server"], { required: true }),
] as const satisfies readonly FieldDoc[];

/** The ticket file's prose sections, in order. */
export const SECTION_FIELDS = [
  field("## Goal", "markdown", ["person", "agent"], { required: true }),
  field("## Acceptance criteria", "markdown", ["person", "agent"], { required: true }),
  field("## Progress", "list", ["agent"], { required: true }),
  field("## Decisions", "list", ["server"], { isNew: true }),
  field("## Result", "markdown", ["agent"], { required: true }),
] as const satisfies readonly FieldDoc[];

/** A person's own handling of a ticket: kept per person beside the read cursors, never in the file. */
export const TRIAGE_FIELDS = [
  field("unread", "boolean", ["person", "server"], { required: true, isNew: true }),
  field("snoozed_until", "timestamp", ["person"], { isNew: true }),
  field("archived", "boolean", ["person"], { required: true, isNew: true }),
] as const satisfies readonly FieldDoc[];

export type FieldPath =
  | (typeof FRONTMATTER_FIELDS)[number]["path"]
  | (typeof SECTION_FIELDS)[number]["path"]
  | (typeof TRIAGE_FIELDS)[number]["path"];

/**
 * What the server refuses, each with the answer a caller gets. The first three are the shipped
 * company mode's; the rest are this spec's.
 */
export const INVARIANTS = [
  { id: "owner_starts", refusal: "403 not_ticket_owner", isNew: false },
  { id: "files_are_truth", refusal: null, isNew: false },
  { id: "one_front", refusal: "403 session_cannot_message", isNew: true },
  { id: "three_points", refusal: null, isNew: true },
  { id: "one_ask", refusal: "409 ask_open", isNew: true },
  { id: "answer_recorded", refusal: null, isNew: true },
  { id: "observe_first", refusal: "409 ticket_not_accepted", isNew: true },
  { id: "triage_apart", refusal: "409 ticket_waiting", isNew: true },
  { id: "verified_first", refusal: "409 not_verified", isNew: true },
  { id: "own_skill_kept", refusal: null, isNew: true },
  { id: "retro_by_count", refusal: null, isNew: true },
  { id: "snapshot_first", refusal: null, isNew: true },
] as const;
export type InvariantId = (typeof INVARIANTS)[number]["id"];
