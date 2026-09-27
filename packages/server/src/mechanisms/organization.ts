/**
 * The organization mechanisms: what a node may require, declared apart from what
 * implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
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
}

/**
 * OrgGateway: what a plugin may do with an organization without holding the organization
 * service — read it, attribute a write, put a line of work on an employee's desk (in nobody's
 * name), open a session for an employee the way a ticket session is opened, and notify the
 * Project's people. Every
 * method is a narrowing of OrganizationService; none adds behaviour the routes do not have.
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
  /** A user-level event to everyone with access to the Project. */
  notifyProject(projectId: string, event: ServerEvent): void;
}>() {}
