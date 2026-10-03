/**
 * The default rules of the proposal operations: who may do what, in which state, and the
 * process checks the store does not make — revision numbers, terminal states, what an approval
 * covers, one impl per PR and per head, comments frozen once sent, an idempotent creation from a
 * roadmap item. They are the rules the service has always applied, error codes and messages
 * included, gathered as plain functions so they can be replaced (ServiceDeps.rules): the store
 * only guarantees the data itself and an append-only history.
 *
 * Every function here is synchronous and pure over its arguments; the write transaction calls
 * them with the proposal as it stands inside it, so no other writer slips between a check and
 * its write. The rules that tell a person from an employee are kept as they are.
 */
import { createHash } from "node:crypto";
import type {
  ProposalBranchRef,
  ProposalComment,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import { ProposalError, type Proposal } from "./domain.js";
import { refKey, refLabel } from "./impl-branch.js";
import type { ProposalTx } from "./ports.js";

/** The caller, resolved: the principal a write is recorded under, and the person behind it when there is one. */
export interface Caller {
  principal: string;
  agentId: string | null;
  userId: string;
  /** The session the call came from, when it came from one. */
  sessionId?: string;
}

const forbidden = (code: string, message: string): ProposalError =>
  new ProposalError(403, code, message);
const conflict = (code: string, message: string): ProposalError =>
  new ProposalError(409, code, message);

export function isPerson(caller: Caller): boolean {
  return caller.agentId === null;
}

function requirePerson(caller: Caller, what: string): void {
  if (!isPerson(caller)) throw forbidden("person_required", `Only a person can ${what}.`);
}

function requireAuthorOrPerson(p: Proposal, caller: Caller, what: string): void {
  if (isPerson(caller) || caller.agentId === p.author) return;
  throw forbidden("not_author", `Only the author (${p.author}) or a person can ${what}.`);
}

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

/** The pending comment `id` of the caller's own, refused once it is sent or when it is another's. */
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

/** The default rules, one per operation; ServiceDeps.rules replaces any of them. */
export const defaultRules = {
  /** A person delegates a proposal; an employee's comes from a roadmap item's approvals. */
  create(caller: Caller): void {
    if (!isPerson(caller)) {
      throw forbidden(
        "roadmap_only",
        "An employee does not create a proposal. A new proposal comes from a roadmap item that a person and the moderator approved: raise it as an item in the roadmap's room. To change an existing proposal, publish a new revision of it.",
      );
    }
  },

  /** The idempotency key of a creation from a roadmap item: the same item and brief create one proposal. */
  createKey(brief: string): string {
    return createHash("sha256").update(brief).digest("hex");
  },

  editBrief(p: Proposal, caller: Caller, brief: string): void {
    requireAuthorOrPerson(p, caller, "rewrite the brief");
    if (brief === "") throw new ProposalError(400, "bad_request", "brief must not be empty.");
    if (brief === p.brief) {
      throw conflict("brief_unchanged", `Proposal #${p.number} already has this brief.`);
    }
  },

  /** Who may publish, and that the proposal takes revisions: the author or a person, not rejected. */
  publish(p: Proposal, caller: Caller): void {
    requireAuthorOrPerson(p, caller, "publish a revision");
    if (p.status === "rejected") {
      throw conflict("proposal_closed", `Proposal #${p.number} is rejected.`);
    }
  },

  /** A new revision is exactly the current one plus one. */
  revision(p: Proposal, revision: number): void {
    if (revision !== p.revision + 1) {
      throw conflict(
        "revision_conflict",
        `Proposal #${p.number} is at revision ${p.revision}; revision ${revision} is not the next one. Reload and publish again.`,
      );
    }
  },

  /**
   * The status after a publish: an approval covers one revision, so a publish after it puts the
   * proposal back to ready (the approved revision stays recorded for the diff).
   */
  afterPublish(p: Proposal): { status: ProposalStatus; reason: string | null } {
    if (p.status !== "approved") return { status: p.status, reason: null };
    return {
      status: "ready",
      reason: `revision ${p.revision + 1} — approval of revision ${p.approvedRevision ?? p.revision} no longer covers it`,
    };
  },

  /**
   * The author's ready answers the requested changes — a revision after the batch, and every
   * comment of it resolved; a person may mark ready regardless.
   */
  ready(p: Proposal, caller: Caller): void {
    requireAuthorOrPerson(p, caller, "mark a proposal ready");
    if (p.status !== "drafting") {
      throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}, not drafting.`);
    }
    requireRevision(p, ": publish it first");
    if (isPerson(caller) || p.openBatches.length === 0) return;
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
  },

  /** A person approves a ready (or drafting) proposal; the approval covers the current revision. */
  approve(p: Proposal, caller: Caller): { approvedRevision: number } {
    requirePerson(caller, "approve a proposal");
    if (p.status !== "ready" && p.status !== "drafting") {
      throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}.`);
    }
    requireRevision(p);
    return { approvedRevision: p.revision };
  },

  /** Anybody in the organization rejects a proposal that is not closed. */
  reject(p: Proposal): void {
    requireNotClosed(p);
  },

  /**
   * Merged is reported from approved. A person and the implementer report on their word; anybody
   * else on the forge's: the answer says whether the forge must confirm the merge first.
   */
  merged(p: Proposal, caller: Caller): { confirmWithForge: boolean } {
    if (p.status !== "approved") {
      throw conflict("proposal_status", `Proposal #${p.number} is ${p.status}, not approved.`);
    }
    return { confirmWithForge: !isPerson(caller) && caller.agentId !== p.implementer };
  },

  implement(p: Proposal, caller: Caller): void {
    requireAuthorOrPerson(p, caller, "ask for an implementation");
    requireNotClosed(p);
    requireRevision(p, ": publish it first");
  },

  discuss(p: Proposal, caller: Caller): void {
    requirePerson(caller, "open a discussion");
    requireNotClosed(p);
  },

  /** A person, or the discussion's own session, concludes a discussion. */
  conclude(p: Proposal, caller: Caller, sessionId: string): void {
    const d = p.discussions.find((x) => x.sessionId === sessionId);
    if (d === undefined) {
      throw new ProposalError(
        404,
        "discussion_not_found",
        `Proposal #${p.number} has no discussion ${sessionId}.`,
      );
    }
    if (!isPerson(caller) && !(caller.agentId === d.agentId && caller.sessionId === sessionId)) {
      throw forbidden(
        "not_discussion",
        `Only a person or the discussion's own session (${sessionId}) can conclude it.`,
      );
    }
  },

  /** A discussion is concluded once. */
  concludeOnce(p: Proposal, sessionId: string): void {
    const d = p.discussions.find((x) => x.sessionId === sessionId);
    if (d !== undefined && d.concluded !== null) {
      throw conflict(
        "discussion_concluded",
        `Discussion ${sessionId} of proposal #${p.number} is already concluded.`,
      );
    }
  },

  comment(caller: Caller): void {
    requirePerson(caller, "comment on a proposal");
  },

  editComment(p: Proposal, caller: Caller, id: string): void {
    ownPending(p, caller, id, "reworded");
  },

  deleteComment(p: Proposal, caller: Caller, id: string): void {
    ownPending(p, caller, id, "withdrawn");
  },

  /** A person sends their pending comments as one batch; a ready proposal goes back to drafting. */
  requestChanges(
    p: Proposal,
    caller: Caller,
  ): { commentIds: string[]; status: ProposalStatus; batchId: string } {
    requirePerson(caller, "request changes");
    const pending = p.comments.filter((c) => c.batchId === null && c.by === caller.principal);
    if (pending.length === 0) {
      throw new ProposalError(400, "bad_request", "No pending comments to send.");
    }
    return {
      commentIds: pending.map((c) => c.id),
      status: p.status === "ready" ? "drafting" : p.status,
      batchId: `b${p.events.filter((e) => e.kind === "changes_requested").length + 1}`,
    };
  },

  /** The author or a person resolves a sent comment, once. */
  resolve(p: Proposal, caller: Caller, id: string): void {
    requireAuthorOrPerson(p, caller, "resolve a comment");
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
  },

  /**
   * One impl per PR and per head: a PR belongs to one proposal, a head to one proposal that is
   * not rejected. Checked inside the write, over the store's impl indexes.
   */
  implUnique(
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
  },
};

export type ProposalRules = typeof defaultRules;
