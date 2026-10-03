/**
 * The plugin's domain objects: plain data, independent of where they are stored. The store
 * (store.ts) assembles them from its tables; the service and the default rules (guards.ts) read
 * them; nothing here knows SQL, git or GitHub.
 */
import type {
  ProposalBranchRef,
  ProposalComment,
  ProposalDiscussion,
  ProposalEvent,
  ProposalMaterial,
  ProposalScopeEntry,
  ProposalSection,
  ProposalStatus,
  ProposalTestEntry,
} from "@prismshadow/penguin-server/api";

/** What a refused operation answers; the route sends it as `{ error: { code, message } }`. */
export class ProposalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

/** A proposal with every fact the store holds about it, before any caller-specific view. */
export interface Proposal {
  number: number;
  title: string;
  status: ProposalStatus;
  revision: number;
  author: string;
  implementer: string | null;
  delegatedBy: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
  /** The scope's root at the head revision ("" = the shared workspace). */
  root: string;
  scope: ProposalScopeEntry[];
  tests: ProposalTestEntry[];
  sections: ProposalSection[];
  materials: ProposalMaterial[];
  /** The impl branch and its PR, once registered. */
  impl: ProposalImpl | null;
  /** The implementation sessions, in the order they were opened. */
  sessions: string[];
  discussions: ProposalDiscussion[];
  comments: ProposalComment[];
  events: ProposalEvent[];
  /** The batches of requested changes since the last `ready` (or creation): what the author's next `ready` must have answered. */
  openBatches: Array<{ id: string; revision: number; commentIds: string[] }>;
  /** The revision the standing approval covers; null until approved. Kept across a later publish (the status is not). */
  approvedRevision: number | null;
  /** The roadmap item it was created for, when a roadmap's approvals created it. */
  roadmap: { number: number; key: string } | null;
  /** The `seq` of the last write about this proposal. */
  seq: number;
}

/** A proposal's impl: the declared branch pair (both null when only a PR was registered) and the PR. */
export interface ProposalImpl {
  head: ProposalBranchRef | null;
  base: ProposalBranchRef | null;
  pr: { url: string; label: string } | null;
  by: string;
  at: string;
}

/** A deployment on the registry, as its `deployments.jsonl` line wrote it. */
export interface RegisteredDeployment {
  id: string;
  /** The penguin server deployment's url; null for a deployment that is not a penguin server. */
  url: string | null;
  installId: string | null;
  at: string;
  by: string;
}

/**
 * The project a proposal, its graph and its impls belong to. Today every organization has one
 * default Project, read from the server-wide settings (`deliveryRepo`, `deliveryBase`,
 * `origins`) or the shared workspace's remotes.
 */
export interface Project {
  /** `owner/repo` of the delivery repository; null when none is configured or found. */
  repo: string | null;
  /** The stack base branch. */
  base: string;
  /** Whether `base` was declared rather than defaulted (an undeclared base follows the default branch). */
  baseDeclared: boolean;
  origins: Array<{ name: string; repo: string }>;
  /** `github` when the delivery repository is on GitHub, `none` when there is none. */
  forge: "github" | "none";
}
