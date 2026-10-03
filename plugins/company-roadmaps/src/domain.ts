/**
 * The roadmap plugin's domain objects: plain data, independent of where they are stored. The
 * store (store.ts) assembles a Roadmap from its tables; the service and the default rules
 * (guards.ts) read them.
 */
import path from "node:path";

/** What a refused operation answers; the route sends it as `{ error: { code, message } }`. */
export class RoadmapError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoadmapError";
  }
}

/** An organization's directory under the data root. */
export function orgDirOf(root: string, projectId: string, orgId: string): string {
  return path.join(root, projectId, "organizations", orgId);
}

/**
 * `awaiting_room`: derived at an establishment, no room bound yet; `discussing`: its room is
 * relayed; `established`: the discussion is over and its items delegated. A reopening takes an
 * established roadmap back to discussing; there is no other state.
 */
export type RoadmapStatus = "awaiting_room" | "discussing" | "established";

/** A proposal the roadmap delegates: its brief and its owner, stacked on another proposal item (or on nothing). */
export interface ProposalItem {
  key: string;
  kind: "proposal";
  title: string;
  brief: string;
  owner: string;
  /** The body sections it draws on, by heading. */
  cites: string[];
  /** The proposal item it is stacked on; absent = the previous proposal item, null = none. */
  stackedOn?: string | null;
  /**
   * An existing proposal the roadmap takes in as it is (adopted): nothing is created for it and
   * it needs no approvals — it has its own page; an establishment links its number at once.
   */
  proposal?: number;
}

/** A roadmap the roadmap derives: its brief and the employees who discuss it (the first moderates). */
export interface RoadmapItem {
  key: string;
  kind: "roadmap";
  title: string;
  brief: string;
  employees: string[];
  cites: string[];
}

export type DraftItem = ProposalItem | RoadmapItem;

/** One employee's session cloned for the room. */
export interface Clone {
  agentId: string;
  sessionId: string;
  openedAt: string;
  closedAt?: string;
}

/** Who approved a proposal item, and when. */
export interface Approval {
  by: string;
  at: string;
}

/** The two approvals a proposal item needs; the second creates its proposal. */
export type ApprovalRole = "person" | "moderator";

/**
 * What an establishment did with one item. A proposal item is established as a **brief**
 * (`stage: "brief"`): nothing is created for it and its owner is not told, until a person and the
 * moderator have both approved that brief. Then its owner is told (`stage: "delegated"`). A
 * roadmap item derives its roadmap at once (`stage: "delegated"`).
 */
export interface Delegation {
  key: string;
  owner: string;
  brief: string;
  /** The item key its proposal is stacked on (proposal items). */
  base: string | null;
  /** The derived roadmap's number (roadmap items). */
  child: number | null;
  delivered: boolean;
  error?: string;
  /** The proposal number linked back. */
  proposal?: number;
  stage: "brief" | "delegated";
  /**
   * The approvals of the brief as it stands: those given on its hash. A changed brief starts
   * again with none; the approvals of the old one stay in the store, not counted.
   */
  approvals: Partial<Record<ApprovalRole, Approval>>;
}

export interface RoadmapEvent {
  seq: number;
  at: string;
  by: string;
  kind: RoadmapWrite["kind"];
  note?: string;
}

export interface Roadmap {
  number: number;
  name: string;
  brief: string;
  channelId: string | null;
  /** The employees it was opened with, in order: the first moderates. */
  employees: string[];
  parent: number | null;
  parentItem: string | null;
  status: RoadmapStatus;
  record: string;
  body: string;
  items: DraftItem[];
  clones: Clone[];
  delegations: Record<string, Delegation>;
  createdBy: string;
  createdAt: string;
  events: RoadmapEvent[];
}

/**
 * One write about a roadmap. Each is one transaction of the store (store.ts): the tables it
 * changes and a `roadmap_events` row; `seq` and `at` are the store's.
 */
export type RoadmapWrite =
  | {
      kind: "opened";
      number: number;
      name: string;
      brief: string;
      channelId: string | null;
      employees: string[];
      parent: number | null;
      parentItem?: string;
      by: string;
    }
  | { kind: "room"; number: number; channelId: string; by: string }
  | {
      kind: "draft";
      number: number;
      record?: string;
      body?: string;
      items?: DraftItem[];
      by: string;
    }
  | { kind: "established"; number: number; by: string }
  | {
      kind: "delegated";
      number: number;
      key: string;
      owner: string;
      brief: string;
      base: string | null;
      child: number | null;
      delivered: boolean;
      error?: string;
      by: string;
    }
  | {
      kind: "briefed";
      number: number;
      key: string;
      owner: string;
      brief: string;
      base: string | null;
      by: string;
    }
  | {
      kind: "approved";
      number: number;
      key: string;
      role: ApprovalRole;
      /** The brief approved: an approval counts only for the brief it was given to. */
      brief: string;
      by: string;
    }
  | { kind: "linked"; number: number; key: string; proposal: number; by: string }
  /** An existing proposal taken in as a proposal item (appended to the items as they stand). */
  | { kind: "adopted"; number: number; item: ProposalItem; by: string }
  | { kind: "reopened"; number: number; reason: string; by: string }
  | { kind: "renamed"; number: number; name: string; by: string }
  | { kind: "clone"; number: number; agentId: string; sessionId: string; by: string }
  | {
      kind: "clone_closed";
      number: number;
      agentId: string;
      sessionId: string;
      reason: string;
      by: string;
    }
  | { kind: "notify_failed"; number: number; agentId: string; error: string; by: string };

