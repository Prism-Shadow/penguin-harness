/**
 * The default guards of the proposal Actions, and the default process rules the writes apply.
 * A guard answers whether a run may go ahead, in which state, with which parameters; a company
 * module may replace any of them (a `guard` contribution, handed the default to build on). The
 * store guarantees only the data itself and an append-only history, so everything here —
 * revision numbers, terminal states, what an approval covers, one impl per PR and per head, an
 * impl's base on the PR graph and a merged PR kept off a branch others stack on,
 * comments frozen once sent, an idempotent creation from a roadmap item and the rewrite of its
 * proposal's brief while that one is open — is a default, not a constraint.
 *
 * The defaults do not tell a person from an employee: whatever a person may do, an employee may
 * do, approvals included. Narrowing that is left to a permission system — save the author of a
 * proposal, which a person changes, or the moderator of the roadmap that created it.
 *
 * Every guard is synchronous and pure over its input; a write asks it again inside its
 * transaction, with the proposal as it stands there and the transaction's lookups (`tx`), so
 * no other writer slips between a check and its write.
 */
import { createHash } from "node:crypto";
import type {
  ProposalBranchRef,
  ProposalComment,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import type { DatabaseSync } from "node:sqlite";
import type { Act, ActionCaller, Guard, GuardInput, Subject } from "./action-model.js";
import { ProposalError, type Proposal } from "./domain.js";
import { refKey, refLabel } from "./impl-branch.js";
import {
  requireBaseOnGraph,
  requireMergedPrNotABase,
  type ImplGraphFacts,
  type PlannedImpl,
} from "./impl-on-graph.js";
import type { ProposalTx } from "./ports.js";

/** The caller, resolved: the principal a write is recorded under, and the person behind it. */
export type Caller = ActionCaller;

const forbidden = (code: string, message: string): ProposalError =>
  new ProposalError(403, code, message);
const conflict = (code: string, message: string): ProposalError =>
  new ProposalError(409, code, message);

function requireNotClosed(p: Proposal): void {
  if (p.status === "merged" || p.status === "rejected") {
    throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}.`);
  }
}

function requireRevision(p: Proposal, hint = ""): void {
  if (p.revision === 0) {
    throw conflict("proposal_empty", `Proposal #${p.number} has no revision yet${hint}.`);
  }
}

/** The proposal a guard is asked about: the state of a proposal, comment or discussion subject. */
function proposalOf(input: GuardInput): Proposal | null {
  return (input.state as Proposal | null) ?? null;
}

/** The part of a comment or discussion subject after the number. */
function restOf(subject: Subject): string {
  const at = subject.id.indexOf("/");
  return at < 0 ? "" : subject.id.slice(at + 1);
}

/** A guard over the proposal, skipped while there is none (the organization's subject). */
function onProposal(check: (p: Proposal, input: GuardInput) => void): Guard {
  return (input) => {
    const p = proposalOf(input);
    if (p !== null) check(p, input);
  };
}

/** The pending comment of the caller's own, refused once it is sent or when it is another's. */
function ownPending(p: Proposal, caller: Caller, id: string, what: string): ProposalComment {
  const c = p.comments.find((x) => x.id === id);
  if (c === undefined) {
    throw new ProposalError(404, "comment_not_found", `No comment ${id} on proposal #${p.number}.`);
  }
  if (c.batchId !== null) {
    throw conflict(
      "comment_sent",
      `Comment ${id} has been sent to the author; it can no longer be ${what}.`,
    );
  }
  if (c.by !== caller.principal) {
    throw forbidden("not_commenter", `Only the one who wrote comment ${id} can have it ${what}.`);
  }
  return c;
}

/** The author's ready answers the requested changes: a revision after the batch, every comment of it resolved. */
function answeredBatches(p: Proposal): void {
  if (p.openBatches.length === 0) return;
  const needRevision = Math.max(...p.openBatches.map((b) => b.revision));
  const unresolved = p.openBatches
    .flatMap((b) => b.commentIds)
    .filter((id) => p.comments.find((c) => c.id === id)?.resolved === undefined);
  if (p.revision > needRevision && unresolved.length === 0) return;
  const why = [
    ...(p.revision <= needRevision
      ? [`no revision has been published since the request (still revision ${p.revision})`]
      : []),
    ...(unresolved.length > 0 ? [`unresolved comments: ${unresolved.join(", ")}`] : []),
  ];
  throw conflict(
    "changes_pending",
    `Proposal #${p.number} has requested changes not answered yet — ${why.join("; ")}. Read them, revise, resolve each, publish, then mark ready: \`penguin org proposal comments ${p.number} --pending\``,
  );
}

/**
 * One impl per PR and per head: a PR belongs to one proposal, a head to one proposal that is
 * not rejected. Checked inside the write, over the store's impl indexes (`tx`).
 */
function implUnique(
  number: number,
  impl: { head: ProposalBranchRef | null; pr: { key: string; label: string } | null },
  tx: ProposalTx,
): void {
  if (impl.pr !== null) {
    const other = tx.implsByPr(impl.pr.key).find((n) => n !== number);
    if (other !== undefined) {
      throw conflict(
        "impl_pr_taken",
        `${impl.pr.label} is already the impl PR of proposal #${other}.`,
      );
    }
  }
  if (impl.head !== null) {
    const other = tx
      .implsByHead(refKey(impl.head))
      .find((o) => o.number !== number && o.status !== "rejected");
    if (other !== undefined) {
      throw conflict(
        "impl_branch_taken",
        `${refLabel(impl.head)} is already the impl branch of proposal #${other.number}.`,
      );
    }
  }
}

const allow: Guard = () => undefined;

/**
 * Inside a write registering an impl (`params.planned`): it is no other proposal's, and — with
 * the facts the service read for it (`params.facts`, impl-on-graph.ts) — it stays on the graph.
 */
const implNotTaken: Guard = onProposal((p, { params, tx }) => {
  const planned = params.planned as PlannedImpl | undefined;
  if (planned === undefined || tx === undefined) return;
  const lookups = tx as ProposalTx;
  implUnique(p.number, planned, lookups);
  const facts = params.facts as ImplGraphFacts | undefined;
  if (facts === undefined) return;
  requireBaseOnGraph(p, planned, facts, lookups);
  requireMergedPrNotABase(p, planned, facts, lookups);
});

/** The default guard of each built-in proposal Action, by key. */
export const proposalGuards: Record<string, Guard> = {
  "proposal.create": allow,

  "proposal.brief": onProposal((p, { params }) => {
    const brief = typeof params.brief === "string" ? params.brief.trim() : undefined;
    if (brief !== undefined && brief !== "" && brief === p.brief) {
      throw conflict("brief_unchanged", `Proposal #${p.number} already has this brief.`);
    }
  }),

  /** A rejected proposal takes no revision; a new one is exactly the current one plus one. */
  "proposal.publish": onProposal((p, { params }) => {
    if (p.status === "rejected") {
      throw conflict("proposal_closed", `Proposal #${p.number} is rejected.`);
    }
    const revision = params.revision;
    if (typeof revision === "number" && revision !== p.revision + 1) {
      throw conflict(
        "revision_conflict",
        `Proposal #${p.number} is at revision ${p.revision}; revision ${revision} is not the next one. Reload and publish again.`,
      );
    }
  }),

  /** From drafting, with a revision; the author's ready answers the requested changes. */
  "proposal.ready": onProposal((p, { caller }) => {
    if (p.status !== "drafting") {
      throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}, not drafting.`);
    }
    requireRevision(p, ": publish it first");
    if (caller.agentId !== null && caller.agentId === p.author) answeredBatches(p);
  }),

  /**
   * A person, or the moderator of the roadmap that created the proposal, hands it to another
   * author. The use case learns that moderator from the roadmaps plugin (RoadmapModeratorOf) and
   * passes it as `params.moderator` (null: none); the registry's check before the run has no
   * such parameter — a caller cannot send one, it is not declared — so an employee is judged
   * by the use case's checks, before and inside the write.
   */
  "proposal.author": onProposal((p, { caller, params }) => {
    const author = typeof params.author === "string" ? params.author.trim() : undefined;
    if (author === p.author) {
      throw conflict(
        "author_unchanged",
        `${author} is already the author of proposal #${p.number}.`,
      );
    }
    if (caller.agentId === null || !("moderator" in params)) return;
    if (params.moderator !== caller.agentId) {
      throw forbidden(
        "not_moderator",
        p.roadmap === null
          ? `Proposal #${p.number} was not created by a roadmap: only a person can change its author.`
          : `Only a person or the moderator of roadmap #${p.roadmap.number} can change the author of proposal #${p.number}.`,
      );
    }
  }),

  "proposal.comment": allow,

  "proposal.comment.edit": onProposal((p, { caller, subject }) => {
    ownPending(p, caller, restOf(subject), "reworded");
  }),

  "proposal.comment.withdraw": onProposal((p, { caller, subject }) => {
    ownPending(p, caller, restOf(subject), "withdrawn");
  }),

  "proposal.requestChanges": allow,

  /** A sent comment is resolved once. */
  "proposal.resolve": onProposal((p, { subject }) => {
    const id = restOf(subject);
    const c = p.comments.find((x) => x.id === id);
    if (c === undefined || c.batchId === null) {
      throw new ProposalError(
        404,
        "comment_not_found",
        `No requested comment ${id} on proposal #${p.number}.`,
      );
    }
    if (c.resolved !== undefined) {
      throw conflict("comment_resolved", `Comment ${id} is already resolved.`);
    }
  }),

  /** A ready (or drafting) proposal with a revision; the approval covers the current revision. */
  "proposal.approve": onProposal((p) => {
    if (p.status !== "ready" && p.status !== "drafting") {
      throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}.`);
    }
    requireRevision(p);
  }),

  "proposal.reject": onProposal((p) => requireNotClosed(p)),

  "proposal.merged": onProposal((p) => {
    if (p.status !== "approved") {
      throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}, not approved.`);
    }
  }),

  "proposal.implement": onProposal((p) => {
    requireNotClosed(p);
    requireRevision(p, ": publish it first");
  }),

  /** Inside the write: the impl about to be registered is no other proposal's, and stays drawable. */
  "proposal.impl": implNotTaken,

  /** The adoption registers impls the same way: each inside its write, none another's. */
  "proposal.impl.adopt": implNotTaken,
  "proposal.material": allow,
  "proposal.feedback": allow,

  "proposal.discuss": onProposal((p) => requireNotClosed(p)),

  /** The discussion exists and is concluded once. */
  "proposal.conclude": onProposal((p, { subject }) => {
    const sessionId = restOf(subject);
    const d = p.discussions.find((x) => x.sessionId === sessionId);
    if (d === undefined) {
      throw new ProposalError(
        404,
        "discussion_not_found",
        `Proposal #${p.number} has no discussion ${sessionId}.`,
      );
    }
    if (d.concluded !== null) {
      throw conflict(
        "discussion_concluded",
        `Discussion ${sessionId} of proposal #${p.number} is already concluded.`,
      );
    }
  }),

  "target.register": allow,
};

// ---------------------------------------------------------------------------
// The process rules a write applies (not guards: what to write, once allowed)
// ---------------------------------------------------------------------------

/** The idempotency key of a creation from a roadmap item: the same item and brief create one proposal. */
export function createKey(brief: string): string {
  return createHash("sha256").update(brief).digest("hex");
}

/**
 * What a roadmap item's changed brief, approved again, does to the proposal the item is linked
 * to: true rewrites that proposal's brief (it is still open), false leaves it and a new proposal
 * is created and linked in its place (it is merged or rejected).
 */
export function rebriefFromRoadmap(p: Proposal): boolean {
  return p.status !== "merged" && p.status !== "rejected";
}

/**
 * The status after a publish: an approval covers one revision, so a publish after it puts the
 * proposal back to ready (the approved revision stays recorded for the diff).
 */
export function afterPublish(p: Proposal): { status: ProposalStatus; reason: string | null } {
  if (p.status !== "approved") return { status: p.status, reason: null };
  return {
    status: "ready",
    reason: `revision ${p.revision + 1} — approval of revision ${p.approvedRevision ?? p.revision} no longer covers it`,
  };
}

/** The caller's pending comments, sent as one batch; a ready proposal goes back to drafting. */
export function batchOf(
  p: Proposal,
  caller: Caller,
): { commentIds: string[]; status: ProposalStatus; batchId: string } {
  const pending = p.comments.filter((c) => c.batchId === null && c.by === caller.principal);
  if (pending.length === 0) {
    throw new ProposalError(400, "bad_request", "No pending comments to send.");
  }
  return {
    commentIds: pending.map((c) => c.id),
    status: p.status === "ready" ? "drafting" : p.status,
    batchId: `b${p.events.filter((e) => e.kind === "changes_requested").length + 1}`,
  };
}

/**
 * Whose report of a merge is taken on their word: the implementer's, and that of whoever
 * approved the revision the approval covers. Anybody else's waits for the forge to confirm
 * the impl PR merged into its default branch (and is refused where there is no forge).
 */
export function mergedOnWord(p: Proposal, caller: Caller): boolean {
  if (caller.agentId !== null && caller.agentId === p.implementer) return true;
  return p.events.some(
    (e) =>
      e.kind === "approved" &&
      e.by === caller.principal &&
      (p.approvedRevision === null || e.revision === p.approvedRevision),
  );
}

// ---------------------------------------------------------------------------
// The guard as a write asks it
// ---------------------------------------------------------------------------

/**
 * What a write runs under: the guard of its Action, asked with the proposal as it stands —
 * before the write, and again inside it with the transaction's lookups — and the run's
 * transaction hook. An Action's run builds it from the registry's (builtin-actions.ts); a use
 * case called directly (a test) gets the default guard of its key.
 */
export interface WriteAct {
  check(state: Proposal | null, opts?: { tx?: ProposalTx; params?: Record<string, unknown> }): void;
  inTx?: (db: DatabaseSync) => void;
  /** The run's notices (Act.notify); absent, a use case delivers what the built-in notify Action would. */
  notify?: Act["notify"];
}

/** The default guard of `key`, for `caller` on `subject` with `params`. */
export function defaultAct(
  key: string,
  caller: Caller,
  subject: Subject,
  params: Record<string, unknown> = {},
): WriteAct {
  const guard = proposalGuards[key] ?? allow;
  return {
    check: (state, opts) =>
      guard({
        caller,
        subject,
        state,
        params: { ...params, ...opts?.params },
        running: 0,
        ...(opts?.tx !== undefined ? { tx: opts.tx } : {}),
      }),
  };
}
