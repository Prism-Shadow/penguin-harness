/**
 * The organization mechanisms: what a node may require, declared apart from what
 * implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type {
  OrgBudgetStateRow,
  OrgCalendarStateRow,
  OrgCacheRepo,
  OrgDeskNoticeRow,
  OrgSessionOwner,
  OrgSessionRow,
  OrgTicketSessionRow,
  OrgTicketStateRow,
} from "./organizations.js";

/** From packages/server (api/types.ts): the org runtime's calendar/ticket outcomes -
 * the org cache rows carry them. */
export type OrgCalendarOutcome = "fired" | "queued" | "paused" | "missed" | "error";

export type OrgTicketChange = "assigned" | "blocked" | "blocker_closed" | "done" | "rejected";

/**
 * OrgCache: the mechanism OrgCacheRepo implements. The whole repo, except that
 * `orgIdsOfProject` is named rather than inherited — a Map has no wire form, so the
 * contract carries it as an opaque host object the way the kernel's other live values are.
 */
@Interface()
export abstract class OrgCache {
  abstract deskSessions(projectId: string, orgId: string): OrgSessionRow[];
  abstract syncDeskSessions(
    projectId: string,
    orgId: string,
    rows: Array<{ sessionId: string; agentId: string; current: boolean }>,
  ): void;
  abstract ticketSessions(projectId: string, orgId: string): OrgTicketSessionRow[];
  abstract syncTicketSessions(
    projectId: string,
    orgId: string,
    rows: Array<{ ticketId: string; sessionId: string; agentId: string }>,
  ): void;
  abstract addTicketSession(
    projectId: string,
    orgId: string,
    ticketId: string,
    sessionId: string,
    agentId: string,
  ): void;
  abstract ownerOfSession(sessionId: string): OrgSessionOwner | null;
  abstract orgIdsOfProject(projectId: string): Opaque<"OrgIdsBySession", Map<string, string>>;
  abstract setTriggerHop(sessionId: string, hop: number): void;
  abstract findCalendar(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
  ): OrgCalendarStateRow | null;
  abstract listCalendar(projectId: string, orgId: string): OrgCalendarStateRow[];
  abstract registerCalendar(args: {
    projectId: string;
    orgId: string;
    agentId: string;
    name: string;
    startAtMs: number;
    defHash: string;
  }): { row: OrgCalendarStateRow; fresh: boolean };
  abstract markCalendarSlot(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    slotMs: number | null,
  ): void;
  abstract markCalendarFired(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    firedAt: string,
    oneShot: boolean,
  ): void;
  abstract markCalendarMissed(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
  ): void;
  abstract markCalendarOutcome(
    projectId: string,
    orgId: string,
    agentId: string,
    name: string,
    outcome: OrgCalendarOutcome,
  ): void;
  abstract deleteMissingCalendar(
    projectId: string,
    orgId: string,
    present: Array<{ agentId: string; name: string }>,
  ): void;
  abstract deleteCalendar(projectId: string, orgId: string, agentId: string, name: string): void;
  abstract findTicketState(
    projectId: string,
    orgId: string,
    ticketId: string,
  ): OrgTicketStateRow | null;
  abstract upsertTicketState(row: OrgTicketStateRow): void;
  abstract deleteMissingTicketState(projectId: string, orgId: string, presentIds: string[]): void;
  abstract channelOffset(projectId: string, orgId: string, channelId: string, date: string): number;
  abstract setChannelOffset(
    projectId: string,
    orgId: string,
    channelId: string,
    date: string,
    offset: number,
  ): void;
  abstract readCursor(
    projectId: string,
    orgId: string,
    channelId: string,
    userId: string,
  ): string | null;
  abstract setReadCursor(
    projectId: string,
    orgId: string,
    channelId: string,
    userId: string,
    lastReadId: string,
  ): void;
  abstract budgetState(
    projectId: string,
    orgId: string,
    agentId: string,
    period: string,
  ): OrgBudgetStateRow | null;
  abstract listBudgetStates(projectId: string, orgId: string, period: string): OrgBudgetStateRow[];
  abstract markBudget(
    projectId: string,
    orgId: string,
    agentId: string,
    period: string,
    patch: { warnedAt?: string | null; pausedAt?: string | null },
  ): void;
  abstract queueDeskNotice(row: Omit<OrgDeskNoticeRow, "seq">): void;
  abstract takeDeskNotices(projectId: string, orgId: string, agentId: string): OrgDeskNoticeRow[];
  abstract deleteDeskNotices(projectId: string, orgId: string, agentId: string): void;
  abstract deleteOrg(projectId: string, orgId: string): void;
  abstract deleteProject(projectId: string): void;
}

// ---------------------------------------------------------------------------
// Channel vocabulary (was api/types.ts's; the CompanyServerEvent names them)
// ---------------------------------------------------------------------------

export type OrgChannelNoticeKind =
  | "employee_joined"
  | "employee_left"
  | "channel_created"
  | "channel_archived"
  | "channel_unarchived"
  | "channel_joined"
  | "channel_invited"
  | "channel_left"
  | "channel_removed"
  | "budget_warned"
  | "budget_paused"
  /**
   * Legacy, read-only: ticket changes no longer write into a channel — the board is read from
   * the board and the overview's inbox. These three kinds stay so the lines already in an
   * organization's message files keep rendering; nothing writes them any more.
   */
  | "ticket_blocked"
  | "ticket_done"
  | "ticket_rejected";

export interface OrgChannelNotice {
  kind: OrgChannelNoticeKind;
  params: Record<string, string>;
}

export interface OrgChannelMessage {
  id: string;
  /** ISO 8601 UTC. */
  time: string;
  /** `agent:<id>` / `user:<id>` / `system`. */
  sender: string;
  hop: number;
  text: string;
  /** Principals mentioned, `all` included. */
  mentions: string[];
  refs?: { ticket?: string; session?: string; replyTo?: string };
  /** Present on `system` lines the server wrote with a structured notice; absent on lines from before the field existed. */
  notice?: OrgChannelNotice;
}

/** The org scheduler's trigger kinds (an org_run event names which one started the run). */
export type OrgTriggerKind = "init" | "event" | "mention" | "ticket_notice" | "ticket_work";
