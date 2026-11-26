/**
 * The vocabulary of the proposed company mode, in one place: the prototype (this directory) acts
 * on it, and the landing's /company page tables it beside the prototype. It is a proposal: `isNew`
 * marks what the shipped company mode does not have yet. Nothing here is language; the words are
 * in the dictionaries of whoever shows an entry.
 *
 * The design it follows is a light, self-running organization: one lead talks with the person and
 * files tickets; an executor does the work and an independent verifier checks it, moved along a
 * state machine the server holds; only a blocker or a final call reaches the person's inbox; each
 * domain is accepted in a workbench of its own; and every call and every send-back is written to
 * a local file the organization learns from.
 */

/** A ticket's statuses, in the order the work moves through them. */
export const TICKET_STATUSES = [
  "proposed",
  "working",
  "verifying",
  "deciding",
  "done",
  "dropped",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Who holds a ticket in each status: the state machine binds every status to one hand. */
export type Holder = "person" | "executor" | "verifier";
export const HOLDER: Record<TicketStatus, Holder | null> = {
  proposed: "person",
  working: "executor",
  verifying: "verifier",
  deciding: "person",
  done: null,
  dropped: null,
};

/** The moves the server allows, each with the one hand that may make it. */
export const TRANSITIONS = [
  { from: "proposed", to: "working", by: "person" },
  { from: "working", to: "verifying", by: "executor" },
  { from: "verifying", to: "working", by: "verifier" },
  { from: "verifying", to: "deciding", by: "verifier" },
  { from: "deciding", to: "working", by: "person" },
  { from: "deciding", to: "done", by: "person" },
] as const satisfies readonly { from: TicketStatus; to: TicketStatus; by: Holder }[];

/** The statuses the stepper draws, in order; `proposed` and `dropped` are off the main line. */
export const MAIN_LINE: readonly TicketStatus[] = ["working", "verifying", "deciding", "done"];

/**
 * Why a ticket waits on the person: a proposal to accept, a question the work stopped on, a
 * limit the server stopped it at, or verified work to accept.
 */
export type Wait = "accept" | "ask" | "halt" | "decide";

/** The part of a ticket the waiting rule and the inbox read. */
export interface TicketState {
  status: TicketStatus;
  /** The work stopped on a question; the A2UI card waits for an answer. */
  asking: boolean;
  /** The server stopped the work at a limit. */
  halted: boolean;
}

/** The reason a ticket waits on the person, or null while it does not. */
export function waitOf(ticket: TicketState): Wait | null {
  if (ticket.status === "proposed") return "accept";
  if (ticket.halted) return "halt";
  if (ticket.asking) return "ask";
  if (ticket.status === "deciding") return "decide";
  return null;
}

/** The inbox's three groups, in the order the column shows them. */
export const INBOX_GROUPS = ["decide", "moving", "settled"] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];

/** The one group a ticket is listed in: what needs the person, what moves without them, what is over. */
export function groupOf(ticket: TicketState): InboxGroup {
  if (waitOf(ticket) !== null) return "decide";
  return ticket.status === "done" || ticket.status === "dropped" ? "settled" : "moving";
}

/** An action that leaves the organization. None runs before the person approves it. */
export const OUTWARD_ACTIONS = ["reply", "merge", "publish", "email", "experiment"] as const;
export type OutwardAction = (typeof OUTWARD_ACTIONS)[number];

/**
 * How an outward action is approved. `draft`: the organization fills a draft and the person sends
 * it themselves; `approve`: one click; `review`: the person reads what it costs or binds and
 * confirms it.
 */
export const OUTWARD_GRADES = ["draft", "approve", "review"] as const;
export type OutwardGrade = (typeof OUTWARD_GRADES)[number];

export const DEFAULT_GRADES: Record<OutwardAction, OutwardGrade> = {
  reply: "draft",
  merge: "approve",
  publish: "approve",
  email: "review",
  experiment: "review",
};

/** The workbench a domain's work is accepted in. */
export const WORKBENCHES = ["code", "experiment", "document", "ledger", "outreach"] as const;
export type Workbench = (typeof WORKBENCHES)[number];

/** What wakes the lead besides the person: an event, at once, or a schedule. */
export const TRIGGERS = ["github", "message", "callback", "patrol", "review"] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** Who writes a field: the person, an agent through `penguin org`, or the server as a fact. */
export type Writer = "person" | "agent" | "server";

export interface FieldDoc<Path extends string = string> {
  /** The key in the ticket's frontmatter, or a `## ` section. */
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
  field("status", TICKET_STATUSES.join(" | "), ["person", "agent", "server"], { required: true }),
  field("owner", "agent:<id>", ["agent"], { required: true }),
  field("verifier", "agent:<id>", ["agent"], { required: true, isNew: true }),
  field("source", "user | lead | event:<kind> | schedule:<id> | review", ["server"], {
    required: true,
    isNew: true,
  }),
  field("workbench", WORKBENCHES.join(" | "), ["agent"], { required: true, isNew: true }),
  field("budget", "{ usd, spent }", ["person", "server"], { required: true, isNew: true }),
  field("rounds", "{ limit, used }", ["person", "server"], { required: true, isNew: true }),
  field("ask", "a2ui form", ["agent"], { isNew: true }),
  field("halt", "budget | rounds", ["server"], { isNew: true }),
  field("outward", "{ action, grade, draft }", ["agent", "server"], { isNew: true }),
  field("runs", "{ by, model, tokens, cache, usd }[]", ["server"], { required: true, isNew: true }),
  field("history", "{ at, by, action, note? }[]", ["server"], { required: true }),
] as const satisfies readonly FieldDoc[];

/** The ticket file's prose sections, in order. */
export const SECTION_FIELDS = [
  field("## Goal", "markdown", ["person", "agent"], { required: true }),
  field("## Acceptance criteria", "markdown", ["person", "agent"], { required: true }),
  field("## Review", "list", ["agent"], { isNew: true }),
  field("## Decisions", "list", ["server"], { isNew: true }),
  field("## Result", "markdown", ["agent"], { required: true }),
] as const satisfies readonly FieldDoc[];

export type FieldPath =
  (typeof FRONTMATTER_FIELDS)[number]["path"] | (typeof SECTION_FIELDS)[number]["path"];

/**
 * What the server enforces, each with the answer a caller gets when it refuses. The first two
 * are the shipped company mode's; the rest are this spec's.
 */
export const INVARIANTS = [
  { id: "files_are_truth", refusal: null, isNew: false },
  { id: "owner_moves", refusal: "403 not_ticket_holder", isNew: false },
  { id: "one_lead", refusal: "403 only_the_lead", isNew: true },
  { id: "verified_first", refusal: "409 not_verified", isNew: true },
  { id: "verifier_apart", refusal: "403 verifier_is_owner", isNew: true },
  { id: "rounds_capped", refusal: "409 round_limit", isNew: true },
  { id: "budget_capped", refusal: "409 over_budget", isNew: true },
  { id: "outward_approved", refusal: "403 outward_needs_approval", isNew: true },
  { id: "delegation_bounded", refusal: "409 delegation_loop", isNew: true },
  { id: "exceptions_only", refusal: null, isNew: true },
  { id: "answer_written", refusal: "409 ask_open", isNew: true },
  { id: "events_wake", refusal: null, isNew: true },
  { id: "snapshot_first", refusal: null, isNew: true },
] as const;
export type InvariantId = (typeof INVARIANTS)[number]["id"];

/** How deep a ticket may hand work down before the server refuses: lead → executor → one helper. */
export const DELEGATION_DEPTH = 2;
