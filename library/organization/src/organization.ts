/**
 * The organization mechanisms: what a node may require, declared apart from what
 * implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { OrgCacheRepo } from "./organizations.js";

/** From packages/server (api/types.ts): the org runtime's calendar/ticket outcomes -
 * the org cache rows carry them. */
export type OrgCalendarOutcome = "fired" | "queued" | "paused" | "missed" | "error";

export type OrgTicketChange = "assigned" | "blocked" | "blocker_closed" | "done" | "rejected";

/**
 * OrgCache: the mechanism OrgCacheRepo implements. The whole repo, except that
 * `orgIdsOfProject` is named rather than inherited — a Map has no wire form, so the
 * contract carries it as an opaque host object the way the kernel's other live values are.
 */
export abstract class OrgCache extends Interface<
  Omit<OrgCacheRepo, "orgIdsOfProject"> & {
    orgIdsOfProject(projectId: string): Opaque<"OrgIdsBySession", Map<string, string>>;
  }
>() {}

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
  | "ticket_ids_migrated"
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
