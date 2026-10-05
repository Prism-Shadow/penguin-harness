/**
 * The organization mechanisms: what a node may require, declared apart from what
 * implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque, Slot } from "@prismshadow/penguin-core/kernel";
import type { OrgCacheRepo } from "../db/repos/organizations.js";
import type { ServerEvent } from "../api/types.js";

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

/**
 * Who performs a write against an organization, as the organization routes attribute it:
 * the signed-in person, plus the session and Agent id a call from inside a Session carries
 * (the CLI's control environment — honoured only behind the local API token; a cookie
 * request's claims are dropped by the route before they get here).
 */
export interface OrgActor {
  userId: string;
  sessionId?: string;
  agentId?: string;
}

/** One employee, as a plugin sees it: id, display name (unique within the organization), title, manager. */
export interface OrgEmployeeView {
  agentId: string;
  name: string;
  title: string;
  reportsTo: string | null;
}

/** An organization, as a plugin sees it: its identity, its people and where its shared workspace is. */
export interface OrgView {
  projectId: string;
  orgId: string;
  name: string;
  status: "active" | "paused";
  language: "zh" | "en";
  /** The shared workspace directory (absolute). */
  workspace: string;
  employees: OrgEmployeeView[];
  /** The Project's people: its owner, then its members. */
  userIds: string[];
  /**
   * The machine the organization runs on when that is not this server, else null. Such an
   * organization is only a mirror here: its sessions are that machine's, and the next copy
   * from it overwrites whatever this server writes into the files.
   */
  machineId: string | null;
}

/**
 * OrgGateway: what a plugin may do with an organization without holding the organization
 * service — read it, attribute a write, put a line of work on an employee's desk (in nobody's
 * name), open a session for an employee the way a ticket session is opened, open an unlisted
 * room for a piece of work and change who is in it, and notify the Project's people. Every
 * method but `openRoom` and `changeRoomMembers` is a narrowing of OrganizationService with no
 * behaviour the routes do not have; `openRoom` is the routes' channel creation with one
 * difference, the channel is left out of the listing, and `changeRoomMembers` is the routes'
 * invite and remove for employees, made by the work that owns the room rather than by a member.
 */
export abstract class OrgGateway extends Interface<{
  /** The admin master switch: every company-mode surface answers 404 while it is off. */
  companyModeEnabled(): boolean;
  /** The organization, or null when it does not exist. */
  organization(projectId: string, orgId: string): Promise<OrgView | null>;
  /** `agent:<id>` when the actor is (or speaks from a session of) an employee, else `user:<id>`. */
  principalOf(projectId: string, orgId: string, actor: OrgActor): Promise<string>;
  /**
   * One line of work on the employee's desk, attributed to no one: `text` is the desk's next
   * user input as given (sender `server`), queued behind a running Task. Fails with
   * `org_paused` / `employee_paused` (budget, its own or an ancestor's) instead of delivering,
   * and with `desk_unavailable` when no desk can be opened.
   */
  deliverToDesk(
    projectId: string,
    orgId: string,
    agentId: string,
    text: string,
  ): Promise<{ sessionId: string; queued: boolean }>;
  /**
   * A session of the employee's Agent, marked as the organization's, started on `body` as
   * its first user input — what a ticket session is, minus the ticket. The workspace defaults
   * to the employee's desk workspace and may name another directory inside the shared one.
   */
  openEmployeeSession(args: {
    projectId: string;
    orgId: string;
    agentId: string;
    title: string;
    body: string;
    workspace?: string;
  }): Promise<{ sessionId: string; workspace: string }>;
  /**
   * A room for one piece of work: a channel like any other — read, posted to, joined and left,
   * its mentions delivered — except that the channel listing leaves it out, so it is reached
   * from the work that opened it and not from the channel list. `by` opens it (a person joins
   * it; an employee is recorded as its creator), and `agentIds` are the employees in it from
   * the start. 409 `channel_exists` when the id is taken; 400 for an id that is not a channel
   * id or an Agent that is not an employee.
   */
  openRoom(args: {
    projectId: string;
    orgId: string;
    channelId: string;
    name: string;
    purpose: string;
    by: string;
    agentIds: string[];
  }): Promise<{ channelId: string }>;
  /**
   * Employees in and out of a channel, for the work that owns it (a room it opened, or a channel
   * it was given): each of `add` joins (an employee only), each of `remove` leaves, and each
   * change is a system line in the channel attributed to `by`, as an invitation or a removal
   * is. People in the channel stay. Answers the employees that actually joined and left — one
   * already in (or already out) changes nothing. 404 `channel_not_found`; 400 for the all-hands
   * channel, a `by` that is not a principal, an Agent in both lists or an Agent in `add` that
   * is not an employee; 409
   * `channel_archived`, and `org_runs_elsewhere` for an organization that runs on another
   * machine. A plugin checks it is there before calling it: a server older than this method
   * has none.
   */
  changeRoomMembers(args: {
    projectId: string;
    orgId: string;
    channelId: string;
    by: string;
    add: string[];
    remove: string[];
  }): Promise<{ added: string[]; removed: string[] }>;
  /** A user-level event to everyone with access to the Project. */
  notifyProject(projectId: string, event: ServerEvent): void;
}>() {}

/** One channel of one organization, as a channel claim is asked about it. */
export interface OrgChannelRef {
  projectId: string;
  orgId: string;
  channelId: string;
}

export interface OrgGatewaySlots {
  /**
   * A plugin that handles a channel's messages itself. Before the scheduler delivers the
   * mentions of a channel's new messages to desks it asks every claim; a channel any claim
   * answers `true` for keeps everything else — the message is recorded, published and read as
   * any other — but no mention in it wakes a desk: the claimant handles the message. Asked
   * under the organization's lock, so a claim answers at once and does its work afterwards; a
   * claim that throws is recorded and counts as not claiming.
   */
  channelClaims: Slot<{ description: string }, (channel: OrgChannelRef) => boolean>;
  /**
   * A plugin that holds resources of an organization — a database connection opened on first
   * use, work in flight, processes whose working directory is inside the organization — and
   * gives them up when the organization is deleted. Called only by a delete, under the
   * organization's lock, after the organization is marked as being deleted (its gateway view
   * answers null, so the plugin's routes answer 404 and no new work starts) and before its
   * directory moves to the trash. A retirement aborts that organization's work in flight,
   * closes its connections and drops its caches, and leaves every other organization alone.
   * Each is awaited in turn for at most 30 s; one that times out or throws is recorded and does
   * not stop the delete. Pausing an organization calls none, and a plugin that stops releases
   * what it holds through its own stop path.
   */
  retirements: Slot<
    { description: string },
    (org: { projectId: string; orgId: string }) => Promise<void>
  >;
}
