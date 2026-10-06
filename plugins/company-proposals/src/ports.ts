/**
 * The ports the use cases depend on. The service (service.ts), the graph refresher
 * (graph-refresh.ts) and the PR status reader (pr-status.ts) speak only these; the adapters —
 * SQLite (store.ts, graph-store.ts), local git (git-mirror.ts), GitHub through `gh` or none
 * (forge.ts) — are replaceable. No SQL and no `gh` above this line.
 *
 * A write of ProposalStore is one transaction. It takes a `plan`: a synchronous function the
 * adapter calls inside that transaction with the proposal as it stands there, which applies the
 * default rules (guards.ts) and answers what to write — or throws a ProposalError, and nothing is
 * written. No other port is called inside: validation, files, the forge and desk deliveries
 * happen in the use case, outside the transaction.
 */
import type {
  ProposalComment,
  ProposalEvent,
  ProposalGraphResponse,
  ProposalMaterial,
  ProposalMaterialKind,
  ProposalPrStatus,
  ProposalRevision,
  ProposalScopeEntry,
  ProposalSection,
  ProposalStatus,
  ProposalTestEntry,
} from "@prismshadow/penguin-server/api";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import type { Comparison, ImplPull, OpenPull, ShutPull } from "./pr-chain.js";
import type { Lineage } from "./graph-lineage.js";
import type { Proposal, ProposalImpl, ProposalImplSide } from "./domain.js";

// ---------------------------------------------------------------------------
// ProposalStore
// ---------------------------------------------------------------------------

/** Who reads: the per-caller parts of a read (unread counts, pending comments) depend on it. */
export interface Viewer {
  principal: string;
  /** Whose read position counts: a person's user id, an employee's principal. */
  reader: string;
}

/** A queue row: everything the list shows, without the text of any revision. */
export interface ProposalSummary {
  number: number;
  title: string;
  status: ProposalStatus;
  revision: number;
  author: string;
  implementer: string | null;
  delegatedBy: string;
  createdAt: string;
  updatedAt: string;
  unread: number;
  pendingComments: number;
  materials: ProposalMaterial[];
  impl: ProposalImpl | null;
}

/** A proposal as the graph and the delivery-repository pick read it. */
export interface ProposalFacts {
  number: number;
  title: string;
  status: ProposalStatus;
  root: string;
  impl: ProposalImpl | null;
  /** The `pr` materials' URLs, in the order they were added. */
  prMaterials: string[];
}

/** What a plan may look up inside the write transaction (the default uniqueness rules). */
export interface ProposalTx {
  /** The proposals whose impl PR is this key (`owner/repo#n`, lower-cased). */
  implsByPr(prKey: string): number[];
  /** The proposals whose impl head is this key (headKey), with their status. */
  implsByHead(headKey: string): Array<{ number: number; status: ProposalStatus }>;
  /**
   * The proposals whose impl head (or base) is a branch of this name, on any repository: their
   * status and the repository that side resolved to when it was registered.
   */
  implsOnBranch(
    side: "head" | "base",
    branch: string,
  ): Array<{ number: number; status: ProposalStatus; repo: string }>;
}

/** A plan: called inside the transaction with the proposal as it stands, answers what to write or throws. */
export type Plan<P, T> = (p: P, tx: ProposalTx) => T;

/** The result of a write: the proposal as it stands after it, and the seq the write took. */
export interface Written {
  proposal: Proposal;
  seq: number;
}

export interface CreatePlan {
  title: string;
  author: string;
  delegatedBy: string;
  brief: string;
  /** The roadmap item and the caller's idempotency key, when a roadmap's approvals create it. */
  roadmap?: { number: number; key: string; createKey: string };
}

export interface PublishPlan {
  revision: number;
  title: string;
  root: string;
  scope: ProposalScopeEntry[];
  tests: ProposalTestEntry[];
  sections: ProposalSection[];
  /** The status after it; when it changes, a status event with `reason` follows the `revised` one. */
  status: ProposalStatus;
  reason: string | null;
  by: string;
}

export interface StatusPlan {
  status: ProposalStatus;
  /** The revision an approval covers (approved only). */
  approvedRevision?: number;
  reason?: string;
  by: string;
}

export interface ImplPlan {
  head: ProposalImplSide | null;
  base: ProposalImplSide | null;
  pr: { url: string; label: string; key: string } | null;
  by: string;
}

export interface BatchPlan {
  id: string;
  commentIds: string[];
  revision: number;
  status: ProposalStatus;
  by: string;
}

/** The new comment's anchor and text; the store keeps it as given, re-anchored at every publish. */
export type CommentPlan = Omit<ProposalComment, "at" | "batchId" | "resolved">;

export interface ProposalStore {
  // Reads: each one a few prepared statements over indexes; none folds a history.
  list(viewer: Viewer): ProposalSummary[];
  get(number: number): Proposal | null;
  revisions(number: number): Array<{ revision: number; by: string; at: string }>;
  revision(number: number, revision: number): ProposalRevision | null;
  /** Every proposal's graph facts, by number. */
  facts(): ProposalFacts[];

  // Writes: one transaction each.
  create(plan: () => CreatePlan): { number: number; seq: number; created: boolean };
  publish(number: number, plan: Plan<Proposal, PublishPlan>): Written;
  setStatus(number: number, plan: Plan<Proposal, StatusPlan>): Written;
  editBrief(number: number, plan: Plan<Proposal, { brief: string; by: string }>): Written;
  /** The author replaced: the header's author and an `author` event naming both, in one transaction. */
  setAuthor(number: number, plan: Plan<Proposal, { author: string; by: string }>): Written;
  startImplementation(
    number: number,
    plan: Plan<Proposal, { implementer: string; sessionId: string; by: string }>,
  ): Written;
  openDiscussion(
    number: number,
    plan: Plan<Proposal, { agentId: string; sessionId: string; by: string }>,
  ): Written;
  concludeDiscussion(
    number: number,
    plan: Plan<Proposal, { sessionId: string; text: string; by: string }>,
  ): Written;
  addMaterial(
    number: number,
    plan: Plan<Proposal, { kind: ProposalMaterialKind; label: string; url: string; by: string }>,
  ): Written;
  /** null from the plan: the impl stands as it is, nothing is written. */
  setImpl(number: number, plan: Plan<Proposal, ImplPlan | null>): Written | null;
  feedback(
    number: number,
    plan: Plan<Proposal, { text: string; runtime: boolean; by: string }>,
  ): Written;
  notifyFailed(number: number, plan: Plan<Proposal, { reason: string; by: string }>): Written;
  addComment(number: number, plan: Plan<Proposal, CommentPlan>): Written;
  editComment(number: number, plan: Plan<Proposal, { id: string; text: string }>): Written;
  deleteComment(number: number, plan: Plan<Proposal, { id: string }>): Written;
  requestChanges(number: number, plan: Plan<Proposal, BatchPlan>): Written;
  resolveComment(
    number: number,
    plan: Plan<Proposal, { id: string; text: string; by: string }>,
  ): Written;
  /** Moves a person's read position forward, never back. */
  markRead(userId: string, number: number, seq: number): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// RoadmapModeratorOf
// ---------------------------------------------------------------------------

/**
 * Who moderates roadmap `number` now, as `actor` reads it — null when it has none or does not
 * exist — asked of the plugin that owns roadmaps (company-roadmaps): the default guard of
 * `proposal.author` lets the moderator of the roadmap that created a proposal hand it to another
 * author. This plugin knows nothing of roadmaps beyond the number a proposal records; the
 * roadmaps plugin provides the port through this plugin's module
 * (CompanyProposalsPlugin.provideRoadmapModerators) while its App runs. It is a function, not
 * an interface, so the module tree compares it across the two packages by its signature.
 * Without it — the roadmaps plugin not installed — no roadmap has a moderator here, and only a
 * person passes.
 */
export type RoadmapModeratorOf = (
  projectId: string,
  orgId: string,
  number: number,
  actor: OrgActor,
) => Promise<string | null>;

// ---------------------------------------------------------------------------
// GitMirror
// ---------------------------------------------------------------------------

/** What `git ls-remote` read of a repository: every branch tip and `refs/pull/<n>/head`, and where HEAD points. */
export interface RemoteRefs {
  refs: Map<string, string>;
  /** The default branch (HEAD's target), null when the remote did not say. */
  head: string | null;
}

/**
 * A blobless bare mirror of one repository: ancestry, merge bases and "the missing commits carry
 * no content" need commits and trees, never file contents. It is not a workspace: it writes no
 * ref of any workspace.
 */
export interface GitMirror {
  lsRemote(signal?: AbortSignal): Promise<RemoteRefs>;
  /** Fetches the given refs (`<ref>` → the same name here); `from` another repository (`owner/repo`) when given. */
  fetch(refs: readonly string[], opts?: { from?: string; signal?: AbortSignal }): Promise<void>;
  /** The commits of these the mirror does not have. */
  missing(oids: readonly string[]): Promise<string[]>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  mergeBase(a: string, b: string): Promise<string | null>;
  treeEquals(a: string, b: string): Promise<boolean>;
  /** Commits in `from` not in `to` (behind) and in `to` not in `from` (ahead). */
  counts(from: string, to: string): Promise<{ ahead: number; behind: number }>;
  /**
   * The commits these heads have that `base` lacks, each with its parents
   * (`git rev-list --parents <heads> --not <base>`): one walk for the heads' ancestry.
   */
  commitsBeyond(
    heads: readonly string[],
    base: string,
    signal?: AbortSignal,
  ): Promise<Map<string, string[]>>;
}

/** One file between two commits, as the mirror's tree diff (rename-detected) and numstat read it. */
export interface MirrorDiffEntry {
  status: "added" | "deleted" | "modified" | "renamed";
  path: string;
  /** The path before a rename; null otherwise. */
  oldPath: string | null;
  /** The blobs on each side; null on the side where the file does not exist. */
  oldOid: string | null;
  newOid: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * The mirror read for an impl branch's diff (impl-diff.ts). The mirror holds commits and trees,
 * no blobs: a diff names the blobs it reads (`changedBlobs`), fetches the missing ones by id, and
 * only then reads counts and patch text. Nothing here writes a ref.
 */
export interface DiffMirror {
  /** The mirror is on disk (a graph refresh built it); a diff never builds it. */
  exists(): boolean;
  /** The commits of these the mirror does not have. */
  missing(oids: readonly string[]): Promise<string[]>;
  /** Fetches the given refs or commits; `from` another repository (`owner/repo`) when given. */
  fetch(refs: readonly string[], opts?: { from?: string; signal?: AbortSignal }): Promise<void>;
  mergeBase(a: string, b: string): Promise<string | null>;
  /** The blobs a diff between the two commits reads, from the trees alone. */
  changedBlobs(from: string, to: string, signal?: AbortSignal): Promise<string[]>;
  /** Fetches these objects by id, writing no ref; `from` another repository when given. */
  fetchObjects(
    oids: readonly string[],
    opts?: { from?: string; signal?: AbortSignal },
  ): Promise<void>;
  /** Each object's size in bytes, null when the mirror lacks it. */
  objectSizes(oids: readonly string[]): Promise<Map<string, number | null>>;
  diffStat(
    from: string,
    to: string,
    opts: { ignoreWhitespace: boolean; signal?: AbortSignal },
  ): Promise<MirrorDiffEntry[]>;
  /** The patch text, `exclude` paths left out, read up to `maxBytes` (`cut` when it stopped there). */
  patch(
    from: string,
    to: string,
    opts: {
      ignoreWhitespace: boolean;
      exclude: readonly string[];
      maxBytes: number;
      signal?: AbortSignal;
    },
  ): Promise<{ text: string; cut: boolean }>;
}

// ---------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------

/** A forge-neutral pull/merge request. */
export interface ChangeRequest {
  repo: string;
  number: number;
  url: string;
  title: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  branch: string;
  head: string;
  base: string;
  closedAt: string | null;
  /** The target repository's default branch, when the forge said. */
  defaultBranch: string | null;
}

/** Which change requests to read: the open ones, the merged or closed ones on some branches, some by number. */
export interface ChangeRequestQuery {
  repo: string;
  open?: boolean;
  /** Head branches whose merged or closed change requests are wanted. */
  shutOn?: readonly string[];
  numbers?: readonly number[];
}

export interface Forge {
  readonly kind: "github" | "none";
  listChangeRequests(query: ChangeRequestQuery, signal?: AbortSignal): Promise<ChangeRequest[]>;
  parseUrl(url: string): { repo: string; number: number } | null;
  webUrl(repo: string, number: number): string;
  /** Whether a change request is merged into its repository's default branch, asked now; null = unknown. */
  isMerged(url: string): Promise<{
    status: ProposalPrStatus;
    base: string | null;
    defaultBranch: string | null;
    landed: boolean;
  } | null>;
}

// ---------------------------------------------------------------------------
// GraphStore
// ---------------------------------------------------------------------------

/** A PR's cached status. */
export interface PrStatusRow {
  key: string;
  status: ProposalPrStatus | null;
  base: string | null;
  defaultBranch: string | null;
  checkedAt: string;
  error: string | null;
}

/** The refresher's state for one repository. */
export interface RefreshState {
  holder: string | null;
  leaseUntil: string | null;
  unchanged: number;
  nextProbeAt: string | null;
  defaultBranch: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

/** The latest snapshot of a (repo, base). */
export interface Snapshot {
  inputKey: string;
  builtAt: string;
  checkedAt: string;
  graph: ProposalGraphResponse;
}

/** What one refresh read and computed, written in one short transaction. */
export interface RefreshWrite {
  repo: string;
  refs: Map<string, string>;
  defaultBranch: string | null;
  /** Change requests read from the forge; `openOf` names the repositories whose open list is complete. */
  pulls: ChangeRequest[];
  openOf: string[];
  comparisons: Array<{ from: string; to: string; cmp: Comparison }>;
  /** The comparisons the layout used: kept from pruning. */
  used: ReadonlyArray<readonly [string, string]>;
  /** Which of the heads contain which, as this refresh walked them (graph-lineage.ts); replaces the stored one. */
  lineage: Lineage;
  /** The layout, keyed by its input; null when the forge was not read (a probe that found nothing changed). */
  snapshot: { base: string; inputKey: string; graph: ProposalGraphResponse } | null;
  nextProbeAt: string;
  unchanged: number;
}

export interface GraphStore {
  refs(repo: string): Map<string, string>;
  openPulls(repo: string): OpenPull[];
  /** The latest merged PR on a branch, else the latest closed one; null for none. */
  shutOn(repo: string, branch: string): ShutPull | null;
  pull(repo: string, number: number): ImplPull | null;
  /** Which heads contain which, as the last refresh walked them (graph-lineage.ts). */
  lineage(repo: string): Map<string, Map<string, number>>;
  /** The comparisons known among these pairs, by `from...to`. */
  comparisons(
    repo: string,
    pairs: ReadonlyArray<readonly [string, string]>,
  ): Map<string, Comparison>;
  /** Every comparison whose `to` is one of these commits (a deployment's), by `from...to`. */
  comparisonsTo(repo: string, commits: readonly string[]): Map<string, Comparison>;
  snapshot(repo: string, base: string, inputKey: string): Snapshot | null;
  latestSnapshot(repo: string, base: string): Snapshot | null;
  /** Inserts a snapshot laid out from the stored facts (keeping the last 20 per repo and base). */
  putSnapshot(repo: string, base: string, inputKey: string, graph: ProposalGraphResponse): void;
  refreshState(repo: string): RefreshState;
  /** Takes the lease when it is free, expired or already the holder's; false when another holds it. */
  acquire(repo: string, holder: string, until: string): boolean;
  release(repo: string, holder: string): void;
  /** A probe that found nothing changed: the latest snapshot checked, the schedule moved. */
  probeUnchanged(repo: string, base: string, unchanged: number, nextProbeAt: string): void;
  failed(repo: string, error: string, nextProbeAt: string): void;
  write(w: RefreshWrite): void;
  prStatuses(keys: readonly string[]): Map<string, PrStatusRow>;
  putPrStatuses(rows: readonly PrStatusRow[]): void;
}

/** One event as the store writes it. */
export type EventRow = Omit<ProposalEvent, "seq" | "at">;
