/**
 * Company mode's API vocabulary: the organization DTOs every route and the CLI project (the
 * files are the truth; every DTO here is a projection). Moved from the server's api/types.ts
 * so the contract lives beside the files and runtime that answer it (services+routes restack
 * S20). One package, no server dependencies — the server imports these; nothing here imports
 * the server.
 */
import type { AgentDeletionInfo } from "@prismshadow/penguin-library-agent/types";
import type { MessagingChannel } from "@prismshadow/penguin-library-messaging/vocabulary";
import type { ScheduleStatus, SessionStatus } from "@prismshadow/penguin-library-session";
import type { OrgCalendarOutcome, OrgChannelMessage } from "./organization.js";

export type {
  OrgCalendarOutcome,
  OrgChannelMessage,
  OrgChannelNotice,
  OrgChannelNoticeKind,
  OrgTicketChange,
  OrgTriggerKind,
} from "./organization.js";

// ---------------------------------------------------------------------------
// Company mode: organizations (files are the truth; every DTO here is a projection)
// ---------------------------------------------------------------------------

/**
 * Organization status: `paused` stops every automatic trigger; humans can still talk to any
 * desk. These two values are the whole lifecycle — no route deletes an organization, so a
 * paused one keeps its conversations, employees, desks and tickets.
 */
export type OrgStatus = "active" | "paused";
/** Approval mode for desk and ticket sessions; unattended runs never get always-ask. */
export type OrgApprovalMode = "allow-all" | "read-only" | "deny-all";
/** The five kanban columns, each a directory under `tickets/<yyyy-mm>/`. */
export type OrgTicketStatus = "proposed" | "in_progress" | "review" | "done" | "rejected";
export type OrgTicketPriority = "P0" | "P1" | "P2";
/** Live employee state: running when the desk or any ticket session has a Task in progress; paused when budget-paused. */
export type OrgEmployeeState = "running" | "idle" | "paused";
/** The ticket changes an employee is told about, listed in the body of its next calendar sweep. */

/** What the last evaluation of a calendar event did. */

/**
 * The organization's working language: the language its handbook, its CEO's initialization
 * run, every employee brief and every desk and ticket run are written in. Detected from the
 * mission at creation (CJK text → `zh`, anything else → `en`) unless the request names one.
 */
export type OrgLanguage = "zh" | "en";

/** The organization's settings as `org_config.toml` records them. */
export interface OrganizationSettings {
  name: string;
  mission: string;
  status: OrgStatus;
  /** IANA timezone: budget periods (natural months) and chat day files follow it. */
  timezone: string;
  approvalMode: OrgApprovalMode;
  /** Chat @-chain limit: a message whose hop reaches it records its mentions without triggering anyone. */
  mentionChainLimit: number;
  budgetWarnRatio: number;
  budgetPauseRatio: number;
  createdBy: string;
  /** The shared workspace root when it is not the organization's own `workspace/` (absolute path). */
  workspace?: string;
  /** The model desks and ticket sessions run on when the employee names none; absent = the Project default. */
  model?: { provider: string; modelId: string };
  /** The working language (`language` in `org_config.toml`); absent on an organization written before the field existed, which reads as `en`. */
  language?: OrgLanguage;
}

/** Period spend against the CEO's budget (= the whole organization). */
export interface OrgSpendSummary {
  /** `yyyy-mm` in the organization's timezone. */
  period: string;
  cost: number;
  budget?: number;
  /** cost / budget; absent without a budget. */
  ratio?: number;
}

export interface OrganizationSummary {
  projectId: string;
  orgId: string;
  name: string;
  mission: string;
  status: OrgStatus;
  employeeCount: number;
  runningCount: number;
  pausedCount: number;
  /** proposed + in_progress + review. */
  openTickets: number;
  blockedTickets: number;
  createdBy: string;
  spend: OrgSpendSummary;
  /** Present when `org_config.toml` / `org_chart.yaml` fail validation: the organization is listed but every automatic trigger is held until it is fixed. */
  invalid?: string;
}

export interface OrganizationsResponse {
  organizations: OrganizationSummary[];
}

/**
 * DELETE /api/projects/:projectId/organizations/:orgId (200). The organization goes to the
 * Project's trash either way. With `?deleteAgents=1&agentIds=a,b` — the Agents the caller's
 * confirmation listed for deletion (`deleteAgents=1` without `agentIds` is a 400) — each of its
 * employees' Agents (its CEO included) that is listed there is then deleted for good, exactly as
 * `DELETE …/agents/:agentId` deletes one, unless it is built in, another organization of the
 * Project still employs it, or another organization's chart cannot be read. Every other
 * employee is kept with its reason. Without the flag the three lists are empty.
 */
export interface OrganizationDeleteResponse {
  orgId: string;
  /** Deleted, each with the deletion its background removal reports (`GET …/agent-deletions/:id`). */
  deletedAgents: Array<{ agentId: string; deletion: AgentDeletionInfo }>;
  /**
   * Left as they are, and why: `builtin`; `employed_elsewhere` (another organization employs it
   * too); `employment_unknown` (another organization's `org_chart.yaml` cannot be read, so it
   * may employ it: those organizations are `unreadableCharts`); `not_confirmed` (not in
   * `agentIds`: hired after the confirmation read the list, or shown as kept there).
   */
  keptAgents: Array<{
    agentId: string;
    reason: "employed_elsewhere" | "builtin" | "employment_unknown" | "not_confirmed";
  }>;
  /** The organizations whose chart could not be read, when an employee was kept for it. */
  unreadableCharts?: UnreadableChart[];
  /** Refused by the delete (a folder that could not be moved, a hire that raced in), with its error. */
  failedAgents: Array<{ agentId: string; code: string; message: string }>;
}

export interface OrgEmployeeItem {
  agentId: string;
  /**
   * What this employee goes by in the organization, unique across it: the chart's `name`, else
   * the Agent's display name, else the id — with the id noted (`name (id)`) when the name is
   * not this employee's alone. It is what every surface shows and what works after `@`.
   */
  name: string;
  /** The `name` as written in the chart, for editing; absent when the entry has none. */
  givenName?: string;
  /**
   * Present when the employee has an avatar: the content revision of the image served at
   * `GET …/employees/:agentId/avatar` (append it as `?rev=` — the image is cached for good).
   * Absent, surfaces draw the letter tile.
   */
  avatarRev?: string;
  title: string;
  /** null for the CEO (the root). */
  reportsTo: string | null;
  duties?: string;
  /** As written in the chart: a sub-directory of the shared workspace (`.` = all of it) or an absolute path. */
  workspace: string;
  /** Where that resolves to; absent when the directory does not exist (the entry is then invalid). */
  resolvedWorkspace?: string;
  /** Monthly budget in USD for this employee plus all subordinates; absent = unbounded. */
  budget?: number;
  model?: { provider: string; modelId: string };
  state: OrgEmployeeState;
  /**
   * The employee's current desk. Absent while the ledger names none, and while the Session
   * it names no longer exists (deleted by hand, or with its Agent): a desk is listed only
   * once it can be opened, and the reconcile pass re-opens a missing one when it can.
   */
  desk?: { sessionId: string; workspace: string; openedAt: string };
  /** Period spend: own sessions, and cumulative (own + every subordinate). */
  spend: { own: number; cumulative: number; ratio?: number };
  /** Why the entry cannot be triggered (missing Agent, missing workspace directory). */
  invalid?: string;
  /**
   * The entry's Agent no longer exists (`invalid` carries the sentence). Its desk cannot be
   * opened; the entry stays until a person makes the employee leave, or until an Agent with
   * the same id is created again (which is how a deleted CEO is restored).
   */
  agentMissing?: true;
}

export interface OrgChartResponse {
  ceoAgentId: string;
  employees: OrgEmployeeItem[];
}

export interface OrgCalendarItem {
  agentId: string;
  name: string;
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  status: ScheduleStatus;
  invalidReason?: string;
  nextFireAt?: string;
  lastFiredAt?: string;
  /** What the most recent evaluation did (absent until the event has been evaluated once). */
  lastOutcome?: OrgCalendarOutcome;
  /** The organization or this employee is paused, so due slots are skipped, not fired. */
  paused: boolean;
}

export interface OrgCalendarResponse {
  events: OrgCalendarItem[];
  invalidFiles: Array<{ agentId: string; name: string; error: string }>;
}

/**
 * One line of a ticket's operation history, kept in the file's frontmatter apart from the
 * progress prose: what was done, by whom (`agent:<id>` / `user:<id>` — an employee is recognised
 * from the Agent id its command subprocesses carry, a person otherwise), and when.
 */
export type OrgTicketHistoryAction =
  | "created"
  | "assigned"
  | "moved"
  | "blocked"
  | "unblocked"
  | "progress"
  | "session_started"
  | "session_attached"
  | "edited";

export interface OrgTicketHistoryEntry {
  at: string;
  by: string;
  action: OrgTicketHistoryAction;
  /** The action's detail: the column moved to, the new owner, the block reason, the session id. */
  note?: string;
}

/**
 * The ticket id's slug: lowercase letters in hyphen-joined words, no digits (the date prefix
 * already carries the numbers), chosen for meaning — derived from an ASCII title, proposed by
 * the Project's model for a title in another language, or passed explicitly.
 */
export { TICKET_SLUG_PATTERN } from "./ticket-id.js";

export interface OrgTicketItem {
  ticketId: string;
  title: string;
  status: OrgTicketStatus;
  /** The ONE responsible principal (`agent:<id>` / `user:<id>`); who filed it is the history's `created` entry. */
  owner: string;
  parent?: string;
  notify: string[];
  priority: OrgTicketPriority;
  due?: string;
  /** Non-empty = blocked; the ticket stays in its column. */
  blocked?: string;
  blockedBy?: string;
  /** Contributing session ids, in the order they were attached. */
  sessions: string[];
  /** Any contributing session has a Task in progress. */
  running: boolean;
  /** Period cost of the contributing sessions (a session attached to n tickets counts 1/n here). */
  cost: number;
  /** Header/column disagreement or a duplicate id: shown with a danger mark, left where it is. */
  invalid?: string;
}

export interface OrgTicketSessionItem {
  sessionId: string;
  agentId: string;
  title?: string;
  status: SessionStatus;
  lastActiveAt?: string;
}

export interface OrgTicketDetail extends OrgTicketItem {
  goal: string;
  acceptanceCriteria: string;
  /** `## Progress` as plain sentences; who wrote one and when is the matching history entry. */
  progress: string[];
  result: string;
  /** The operation history from the frontmatter, oldest first. */
  history: OrgTicketHistoryEntry[];
  /** The whole file, for the Markdown view and for clients that prefer to edit it as text. */
  body: string;
  children: string[];
  /** Own cost plus every descendant's along `Parent`. */
  rolledUpCost: number;
  sessionItems: OrgTicketSessionItem[];
}

export interface OrgTicketsResponse {
  columns: Record<OrgTicketStatus, OrgTicketItem[]>;
  /** Files that failed to parse (skipped; also recorded as errors). */
  invalidFiles: Array<{ path: string; error: string }>;
}

/**
 * One channel as the API reports it. The all-hands channel (`default_channel`,
 * `everyone: true`) exists for as long as the organization does and every employee and
 * Project member is in it; every other channel carries the membership its members edit.
 */
export interface OrgChannelItem {
  channelId: string;
  /** As stored; the UI renders the all-hands channel's label itself. */
  name: string;
  /** "" when unset. */
  purpose: string;
  /** True only for `default_channel`: membership is implicit. */
  everyone: boolean;
  /** An archived channel is read-only and folded away. */
  archived: boolean;
  /** `user:<id>` / `agent:<id>` / `system`. */
  createdBy: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** Implicit membership counted for the all-hands channel. */
  memberCount: number;
  /** Whether the caller (person or employee) is a member. */
  isMember: boolean;
  /** People only; 0 for an employee caller. */
  unread: number;
  /** People only; 0 for an employee caller. */
  mentionsMe: number;
  lastMessageAt: string | null;
}

export interface OrgChannelMember {
  /** `agent:<id>` or `user:<id>`. */
  principal: string;
  name: string;
  kind: "agent" | "user";
}

export interface OrgChannelDetail extends OrgChannelItem {
  /** The all-hands channel resolves to every employee plus every Project member. */
  members: OrgChannelMember[];
}

export interface OrgChannelsResponse {
  /** `default_channel` first, then by name. */
  channels: OrgChannelItem[];
}

export interface OrgChannelCreateRequest {
  channelId: string;
  name?: string;
  purpose?: string;
}

export interface OrgChannelPatchRequest {
  name?: string;
  purpose?: string;
  archived?: boolean;
}

export interface OrgChannelMemberRequest {
  /** `agent:<id>` (an employee) or `user:<id>` (a Project member). */
  principal: string;
}

export interface OrgChannelMessagesResponse {
  /** The channel served. */
  channelId: string;
  /** The day file served (`yyyy-mm-dd` in the organization's timezone). */
  date: string;
  /** The days this channel has a file for, newest first, for paging back. */
  days: string[];
  messages: OrgChannelMessage[];
  /** Messages of this channel after the caller's read cursor in it, across the recent days. */
  unread: number;
  /** Of those, the ones that mention the caller (or all). */
  mentionsMe: number;
  lastReadId?: string;
}

export interface OrgBudgetAlert {
  agentId: string;
  period: string;
  warnedAt?: string;
  pausedAt?: string;
}

export interface OrgFinanceEmployee {
  agentId: string;
  name: string;
  title: string;
  reportsTo: string | null;
  own: number;
  cumulative: number;
  budget?: number;
  ratio?: number;
  warned: boolean;
  paused: boolean;
}

export interface OrgFinanceTicket {
  ticketId: string;
  title: string;
  status: OrgTicketStatus;
  parent?: string;
  cost: number;
  rolledUp: number;
}

export interface OrgFinanceResponse {
  period: string;
  currency: "USD";
  employees: OrgFinanceEmployee[];
  tickets: OrgFinanceTicket[];
  /** Daily cost of the organization's sessions over the period. */
  daily: Array<{ date: string; cost: number }>;
  alerts: OrgBudgetAlert[];
  total: number;
  /** Some usage ran on a model without pricing: tokens were counted, cost is a lower bound. */
  unpriced: boolean;
}

export interface OrgDeskItem {
  agentId: string;
  name: string;
  sessionId: string;
  title?: string;
  status: SessionStatus;
  workspace: string;
  lastActiveAt?: string;
  /**
   * Present when the desk session has an ENABLED messaging binding: its channel, read as
   * `SessionInfo.messagingChannel` is (the company sidebar's desk row draws the same mark as a
   * development row, and the development list never holds a desk).
   */
  messagingChannel?: MessagingChannel;
}

export interface OrgSessionsResponse {
  /** One per employee whose current desk Session exists; a desk the ledger names but the server no longer has is left out. */
  desks: OrgDeskItem[];
  tickets: Array<{
    ticketId: string;
    title: string;
    status: OrgTicketStatus;
    sessions: OrgTicketSessionItem[];
  }>;
}

export interface OrgDeskResponse {
  agentId: string;
  sessionId: string;
  workspace: string;
  openedAt: string;
  /** True when this call created the desk session. */
  created: boolean;
}

export interface OrganizationDetail extends OrganizationSummary {
  settings: OrganizationSettings;
  board: Record<OrgTicketStatus, number>;
  /** Today's calendar events (organization timezone) with their outcomes. */
  today: OrgCalendarItem[];
  pending: {
    /** Unread messages mentioning the caller (or all). */
    mentions: number;
    reviewTickets: OrgTicketItem[];
    blockedByMe: OrgTicketItem[];
  };
  /** The last messages of the all-hands channel. */
  recentMessages: OrgChannelMessage[];
  alerts: OrgBudgetAlert[];
  /** What the overview's inbox lists; absent only from a server older than the field. */
  inbox?: OrgInbox;
  /** The CEO's desk session once opened (creation opens it). */
  ceoDeskSessionId?: string;
}

/**
 * The overview's inbox: the three things a person is waited on or told about — messages
 * that name them (or `@all`) in the all-hands channel, the tickets that are blocked (all of
 * them, whoever they wait on), and the tickets closed as done this period. Newest first in
 * each list; each capped at a page.
 */
export interface OrgInbox {
  mentions: OrgChannelMessage[];
  blockedTickets: OrgTicketItem[];
  doneTickets: Array<OrgTicketItem & { closedAt?: string }>;
}

export interface OrganizationCreateRequest {
  /** Semantic id, unique within the Project; also the directory name. */
  orgId: string;
  name?: string;
  mission: string;
  timezone?: string;
  /** An existing absolute directory to use as the shared workspace; default = the organization's own `workspace/`. */
  workspace?: string;
  /** The model for desks and ticket sessions (a configured pair); default = the Project default. */
  model?: { provider: string; modelId: string };
  /**
   * The CEO's monthly budget in USD, written as the `budget` of its `org_chart.yaml` entry.
   * Budgets are compared on the cumulative line, so the CEO's is the whole company's.
   * Omitted = 100; 0 is a real (zero) budget, not "unbounded" — only clearing the field
   * later (`PATCH …/employees/:agentId` with `budget: null`) leaves the CEO unbounded.
   */
  ceoBudget?: number;
  /** The working language; omitted = detected from the mission. */
  language?: OrgLanguage;
}

export interface OrganizationPatchRequest {
  name?: string;
  mission?: string;
  status?: OrgStatus;
  approvalMode?: OrgApprovalMode;
  timezone?: string;
  mentionChainLimit?: number;
  budgetWarnRatio?: number;
  budgetPauseRatio?: number;
  /** null returns to the organization's own `workspace/`. */
  workspace?: string | null;
  /** null returns to the Project default. */
  model?: { provider: string; modelId: string } | null;
  language?: OrgLanguage;
}

/**
 * What a proposed semantic id names. Each kind has its own shape — organization and channel
 * ids carry a `co_` / `ch_` prefix, a non-admin's Project id its owner's `<username>-`, a
 * Benchmark id is kebab-case — and its own set of ids to avoid.
 */
export type SemanticIdKind = "org" | "channel" | "project" | "agent" | "benchmark";

/**
 * A semantic id proposed for a display name — every create dialog that names an object with a
 * semantic id (a Project, an Agent, a Benchmark, an organization, a channel) lets the user name
 * the thing first and derive the id from that name. The server asks the Project's default
 * model for a short English id in the kind's spelling (a Chinese name has no mechanical
 * transliteration), falling back to an ASCII slug of the name when the model is unavailable,
 * and to a dated placeholder when neither can name it. The request never fails for a name it
 * cannot translate: a dialog that asked for an id always gets one back.
 */
export interface SemanticIdSuggestRequest {
  /** The display name typed so far (or the mission / description, when nothing else names the thing). */
  name: string;
  /** What the id is for: decides the id's shape, the prompt's examples and the ids avoided. */
  kind: SemanticIdKind;
  /**
   * Ids already in use in the target scope; the proposal avoids them. For a Project, an Agent or
   * a Benchmark, the server also avoids, on its own, every id that kind's create route refuses
   * as taken, a leftover folder no list shows included.
   */
  taken?: string[];
}

/**
 * Why a proposal fell all the way through to a placeholder — what the client tells the user to
 * explain the id it was just handed. `no_default_model`: the Project has no default model to
 * ask. `model_failed`: it was asked and the request failed (no credential, a rejection, a
 * timeout). `unusable_answer`: it answered twice and neither answer yielded an id.
 * `no_ascii`: no model was consulted at all and the name carries no ASCII to transliterate.
 */
export type SemanticIdSuggestReason =
  "no_default_model" | "model_failed" | "unusable_answer" | "no_ascii";

export interface SemanticIdSuggestResponse {
  /**
   * An id the kind's create route accepts, not in `taken`: `^[a-z][a-z0-9_]{1,63}$` for most
   * kinds, `<username>-<suffix>` for a non-admin's Project, kebab-case for a Benchmark.
   */
  id: string;
  /** Who produced it: the model, the ASCII fallback, or the dated placeholder that names nothing. */
  source: "model" | "fallback" | "placeholder";
  /** Present only with `source: "placeholder"`: why the two real paths produced nothing. */
  reason?: SemanticIdSuggestReason;
}

export interface OrgHireRequest {
  /** Employ an existing Agent … */
  agentId?: string;
  /** … or create one (the two are exclusive). Plugins default to agent-company + agent-development. */
  newAgent?: { agentId: string; name?: string; description?: string; plugins?: string[] };
  /**
   * What the organization calls the employee (any script, one line, no `@`, ≤ 64 characters).
   * Omitted, a new Agent's `name` is used; with neither, the Agent's display name stands in.
   */
  name?: string;
  title: string;
  reportsTo: string;
  workspace?: string;
  budget?: number;
  duties?: string;
  model?: { provider: string; modelId: string };
}

export interface OrgEmployeePatchRequest {
  /** null (or an empty string) clears the name: back to the Agent's display name. */
  name?: string | null;
  title?: string;
  reportsTo?: string;
  workspace?: string;
  /** null clears the budget. */
  budget?: number | null;
  duties?: string;
  /** null clears the model (back to the Project default). */
  model?: { provider: string; modelId: string } | null;
}

export interface OrgCalendarUpsertRequest {
  /** POST only: the employee the event belongs to. */
  agentId?: string;
  /** POST only: the file name. */
  name?: string;
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
}

/**
 * What a calendar write answers: the stored event, plus advisory `warnings` — one line each —
 * about the rota: another employee's recurring event on the same start minute, or the same
 * employee already holding a recurring event (desks that fire together compete for the same
 * budget minute and the same tickets). The write succeeds regardless; the CLI prints the
 * lines so the scheduling employee can stagger.
 */
export interface OrgCalendarWriteResponse extends OrgCalendarItem {
  warnings?: string[];
}

export interface OrgTicketCreateRequest {
  title: string;
  /** Overrides the slug derived from the title; lowercase English words joined by hyphens. */
  slug?: string;
  goal?: string;
  acceptanceCriteria?: string;
  /** The whole Markdown body instead of goal + acceptanceCriteria (the frontmatter is still generated). */
  body?: string;
  /**
   * The responsible principal: an employee's `agent:<id>` (or bare Agent id) or a member's
   * `user:<id>`. Default = the caller — the session's employee inside a desk or ticket
   * session, else the token's or cookie's user.
   */
  owner?: string;
  parent?: string;
  notify?: string[];
  priority?: OrgTicketPriority;
  due?: string;
}

export interface OrgTicketUpdateRequest {
  title?: string;
  /** The new responsible principal; never null — a ticket always has an owner. */
  owner?: string;
  parent?: string | null;
  notify?: string[];
  priority?: OrgTicketPriority;
  due?: string | null;
  goal?: string;
  acceptanceCriteria?: string;
  result?: string;
}

export interface OrgTicketMoveRequest {
  status: OrgTicketStatus;
  /** Required when moving into rejected; recorded under Result. */
  reason?: string;
}

export interface OrgTicketBlockRequest {
  reason: string;
  /** A ticket id or a principal. */
  by?: string;
}

export interface OrgTicketProgressRequest {
  text: string;
  /**
   * The calling session (CLI: PENGUIN_SESSION_ID); the session is booked as a contributing
   * session and the history entry is attributed to its employee. Honoured only for a request
   * carrying the local API token — the control environment's credential; a signed-in user's
   * write is attributed to the user.
   */
  sessionId?: string;
  /**
   * The calling employee's Agent id (CLI: PENGUIN_AGENT_ID from the control environment), the
   * identity a write is recorded under; it wins over the session's employee, is honoured only
   * with the local API token, like sessionId, and is ignored — the write falls back to the
   * session's employee, then to the person — when it names no employee.
   */
  agentId?: string;
}

export interface OrgTicketStartRequest {
  /** The employee the ticket session runs as (CLI: PENGUIN_AGENT_ID); defaults to the ticket owner. */
  agentId?: string;
  message?: string;
  /** Another directory inside the shared workspace; defaults to the employee's desk workspace. */
  workspace?: string;
}

export interface OrgTicketStartResponse {
  sessionId: string;
}

export interface OrgTicketAttachRequest {
  sessionId: string;
}

export interface OrgChannelMessageSendRequest {
  text: string;
  refs?: { ticket?: string; session?: string; replyTo?: string };
  /**
   * The calling session (CLI: PENGUIN_SESSION_ID): the message is sent as its Agent and
   * inherits its hop. Honoured only for a request carrying the local API token — the control
   * environment's credential; a signed-in user's message is sent as the user, at hop 0.
   */
  sessionId?: string;
}

export interface OrgChannelReadRequest {
  /** Mark everything up to this message id as read. */
  upTo: string;
}

/** The handbook index (`handbook/README.md`), the file every work run reads first. */
export interface OrgHandbookResponse {
  content: string;
}

/** One file of the organization handbook (`handbook/`, the company's knowledge base); `path` is relative to that directory. */
export interface OrgHandbookFile {
  path: string;
  size: number;
  updatedAt: string;
}

export interface OrgHandbookFilesResponse {
  /**
   * The handbook directory's absolute path on this server: the Web App browses it with the Files
   * panel's own directory-addressed routes, which take the same Project access these do.
   */
  dir: string;
  /** The index first, then the other documents by path. */
  files: OrgHandbookFile[];
}

export interface OrgHandbookFileResponse {
  path: string;
  content: string;
}

export interface OrgHandbookFileWriteRequest {
  content: string;
}


/** One organization employing an Agent, as the Agent list carries it (see the Agent list's `employments`). */
export interface Employment {
  orgId: string;
  /** The organization's display name (`org_config.toml`), the id when the config does not parse. */
  orgName: string;
  /** The Agent's title in that organization's chart; "CEO" for the CEO of a chart that does not parse. */
  title: string;
  status: OrgStatus;
}

/** An organization whose `org_chart.yaml` cannot be read (missing, or does not parse). */
export interface UnreadableChart {
  orgId: string;
  /** Its display name (`org_config.toml`), the id when the config does not parse. */
  orgName: string;
}
