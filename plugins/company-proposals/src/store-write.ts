/**
 * ProposalStore's SQLite adapter, its write side. Each write is one `BEGIN IMMEDIATE`
 * transaction: read the proposal as it stands, call the use case's plan (which applies the
 * default rules of guards.ts and may refuse), take a `seq`, write the header, the dependent
 * table and the timeline event. No `await` inside.
 *
 * `seq` is the organization's write counter: every write about a proposal takes the next value,
 * the header records the last one, and an event is keyed by the seq of its write — a write that
 * records two events (a revision that also puts an approved proposal back to ready) takes two.
 */
import type { DatabaseSync } from "node:sqlite";
import type {
  ProposalComment,
  ProposalMaterialKind,
  ProposalSection,
} from "@prismshadow/penguin-server/api";
import { locateQuote, paragraphAtOffset, sectionSource } from "./comments.js";
import { ProposalError, type Proposal } from "./domain.js";
import { refKey } from "./impl-branch.js";
import { pullKey } from "./pr-chain.js";
import type {
  BatchPlan,
  CommentPlan,
  CreatePlan,
  EventRow,
  ImplPlan,
  Plan,
  ProposalStore,
  PublishPlan,
  StatusPlan,
  Written,
} from "./ports.js";
import { GRAPH_SCHEMA, immediate, openCompanyDb, PROPOSAL_SCHEMA } from "./schema.js";
import { ProposalReads } from "./store.js";

const notFound = (number: number): ProposalError =>
  new ProposalError(404, "proposal_not_found", `Proposal #${number} does not exist.`);

export class SqliteProposalStore extends ProposalReads implements ProposalStore {
  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    super(db);
  }

  /**
   * Opens (creating when absent) an organization's `company.db` with this plugin's tables — the
   * proposals' and the graph's (graph-store.ts shares the connection).
   */
  static open(file: string, now?: () => number): SqliteProposalStore {
    return new SqliteProposalStore(openCompanyDb(file, PROPOSAL_SCHEMA + GRAPH_SCHEMA), now);
  }

  close(): void {
    this.db.close();
  }

  private at(): string {
    return new Date(this.now()).toISOString();
  }

  private nextSeq(): number {
    const row = this.q(
      `INSERT INTO proposal_seq (id, value) VALUES (1, 1)
         ON CONFLICT (id) DO UPDATE SET value = value + 1 RETURNING value`,
    ).get() as { value: number };
    return Number(row.value);
  }

  private event(number: number, seq: number, at: string, e: EventRow): void {
    this.q(
      `INSERT INTO proposal_events (seq, number, at, kind, by, revision, url, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(seq, number, at, e.kind, e.by, e.revision ?? null, e.url ?? null, e.text ?? null);
  }

  private touch(number: number, seq: number, at: string): void {
    this.q(`UPDATE proposals SET seq = ?, updated_at = ? WHERE number = ?`).run(seq, at, number);
  }

  /**
   * One write about an existing proposal: the plan reads it inside the transaction, `apply`
   * writes what the plan answered; a null plan writes nothing.
   */
  private write<T>(
    number: number,
    plan: Plan<Proposal, T>,
    apply: (p: Proposal, planned: NonNullable<T>, seq: number, at: string) => number | void,
  ): Written | null {
    const out = immediate(this.db, () => {
      const p = this.get(number);
      if (p === null) throw notFound(number);
      const planned = plan(p, this.tx());
      if (planned === null || planned === undefined) return null;
      const at = this.at();
      const seq = this.nextSeq();
      const last = apply(p, planned as NonNullable<T>, seq, at) ?? seq;
      this.touch(number, last, at);
      return last;
    });
    return out === null ? null : { proposal: this.get(number)!, seq: out };
  }

  private must<T>(
    number: number,
    plan: Plan<Proposal, T>,
    apply: (p: Proposal, planned: NonNullable<T>, seq: number, at: string) => number | void,
  ): Written {
    return this.write(number, plan, apply)!;
  }

  create(plan: () => CreatePlan): { number: number; seq: number; created: boolean } {
    return immediate(this.db, () => {
      const c = plan();
      if (c.roadmap !== undefined) {
        const found = this.q(
          `SELECT number, seq FROM proposals
            WHERE roadmap_number = ? AND roadmap_key = ? AND roadmap_create_key = ?`,
        ).get(c.roadmap.number, c.roadmap.key, c.roadmap.createKey) as
          { number: number; seq: number } | undefined;
        if (found !== undefined) {
          return { number: Number(found.number), seq: Number(found.seq), created: false };
        }
      }
      const max = this.q(`SELECT max(number) AS n FROM proposals`).get() as { n: number | null };
      const number = Number(max.n ?? 0) + 1;
      const at = this.at();
      const seq = this.nextSeq();
      this.q(
        `INSERT INTO proposals (number, status, revision, author, delegated_by, roadmap_number,
           roadmap_key, roadmap_create_key, created_at, updated_at, seq, title, brief)
         VALUES (?, 'drafting', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        number,
        c.author,
        c.delegatedBy,
        c.roadmap?.number ?? null,
        c.roadmap?.key ?? null,
        c.roadmap?.createKey ?? null,
        at,
        at,
        seq,
        c.title,
        c.brief,
      );
      this.event(number, seq, at, { kind: "created", by: c.delegatedBy });
      return { number, seq, created: true };
    });
  }

  publish(number: number, plan: Plan<Proposal, PublishPlan>): Written {
    return this.must(number, plan, (p, r, seq, at) => {
      this.q(
        `INSERT INTO proposal_revisions (number, revision, by, at, title, root, scope, tests, sections)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        number,
        r.revision,
        r.by,
        at,
        r.title,
        r.root,
        JSON.stringify(r.scope),
        JSON.stringify(r.tests),
        JSON.stringify(r.sections),
      );
      this.q(`UPDATE proposals SET revision = ?, title = ? WHERE number = ?`).run(
        r.revision,
        r.title,
        number,
      );
      // Every comment follows its passage into the new text; one whose passage is gone keeps
      // the revision it was last found in and is listed as a comment on that revision.
      for (const c of p.comments) this.reanchor(number, c, r.sections, r.revision);
      this.event(number, seq, at, {
        kind: "revised",
        by: r.by,
        text: r.title,
        revision: r.revision,
      });
      if (r.status === p.status) return seq;
      const next = this.nextSeq();
      this.status(
        number,
        p,
        { status: r.status, by: r.by, ...(r.reason !== null ? { reason: r.reason } : {}) },
        next,
        at,
      );
      return next;
    });
  }

  private reanchor(
    number: number,
    c: ProposalComment,
    sections: readonly ProposalSection[],
    revision: number,
  ): void {
    const section = sections.find((s) => s.id === c.sectionId);
    const found = section === undefined ? null : locateQuote(sectionSource(section), c.quote);
    if (section === undefined || found === null) {
      this.q(`UPDATE proposal_comments SET paragraph_id = NULL WHERE number = ? AND id = ?`).run(
        number,
        c.id,
      );
      return;
    }
    this.q(
      `UPDATE proposal_comments SET range_start = ?, range_end = ?, revision = ?, paragraph_id = ?
        WHERE number = ? AND id = ?`,
    ).run(found.start, found.end, revision, paragraphAtOffset(section, found.start), number, c.id);
  }

  /** A status change and its event; a `ready` answers every open batch before it. */
  private status(number: number, p: Proposal, s: StatusPlan, seq: number, at: string): void {
    this.q(`UPDATE proposals SET status = ? WHERE number = ?`).run(s.status, number);
    if (s.status === "approved") {
      const revision = s.approvedRevision ?? p.revision;
      this.q(`UPDATE proposals SET approved_revision = ? WHERE number = ?`).run(revision, number);
      this.event(number, seq, at, { kind: "approved", by: s.by, revision });
      return;
    }
    if (s.status === "ready") {
      this.q(`UPDATE proposal_batches SET open = 0 WHERE number = ? AND open = 1`).run(number);
    }
    if (s.status === "drafting") return;
    this.event(number, seq, at, {
      kind: s.status,
      by: s.by,
      ...(s.reason !== undefined ? { text: s.reason } : {}),
    });
  }

  setStatus(number: number, plan: Plan<Proposal, StatusPlan>): Written {
    return this.must(number, plan, (p, s, seq, at) => this.status(number, p, s, seq, at));
  }

  editBrief(number: number, plan: Plan<Proposal, { brief: string; by: string }>): Written {
    return this.must(number, plan, (_p, b, seq, at) => {
      this.q(`UPDATE proposals SET brief = ? WHERE number = ?`).run(b.brief, number);
      this.event(number, seq, at, { kind: "brief_edited", by: b.by, text: b.brief });
    });
  }

  startImplementation(
    number: number,
    plan: Plan<Proposal, { implementer: string; sessionId: string; by: string }>,
  ): Written {
    return this.must(number, plan, (_p, i, seq, at) => {
      this.q(`UPDATE proposals SET implementer = ? WHERE number = ?`).run(i.implementer, number);
      this.q(
        `INSERT INTO proposal_sessions (session_id, number, kind, agent_id, by, at)
         VALUES (?, ?, 'implementation', ?, ?, ?)`,
      ).run(i.sessionId, number, i.implementer, i.by, at);
      this.event(number, seq, at, {
        kind: "implementation_started",
        by: i.by,
        text: i.implementer,
      });
    });
  }

  openDiscussion(
    number: number,
    plan: Plan<Proposal, { agentId: string; sessionId: string; by: string }>,
  ): Written {
    return this.must(number, plan, (_p, d, seq, at) => {
      this.q(
        `INSERT INTO proposal_sessions (session_id, number, kind, agent_id, by, at)
         VALUES (?, ?, 'discussion', ?, ?, ?)`,
      ).run(d.sessionId, number, d.agentId, d.by, at);
      this.event(number, seq, at, { kind: "discussion_started", by: d.by, text: d.agentId });
    });
  }

  concludeDiscussion(
    number: number,
    plan: Plan<Proposal, { sessionId: string; text: string; by: string }>,
  ): Written {
    return this.must(number, plan, (_p, d, seq, at) => {
      this.q(
        `UPDATE proposal_sessions SET concluded_by = ?, concluded_at = ?, conclusion = ?
          WHERE session_id = ? AND number = ? AND kind = 'discussion'`,
      ).run(d.by, at, d.text, d.sessionId, number);
      this.event(number, seq, at, { kind: "discussion_concluded", by: d.by, text: d.text });
    });
  }

  addMaterial(
    number: number,
    plan: Plan<Proposal, { kind: ProposalMaterialKind; label: string; url: string; by: string }>,
  ): Written {
    return this.must(number, plan, (_p, m, seq, at) => {
      this.q(
        `INSERT INTO proposal_materials (number, kind, label, url, pr_key, by, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(number, m.kind, m.label, m.url, m.kind === "pr" ? pullKey(m.url) : null, m.by, at);
      this.event(number, seq, at, { kind: "material_added", by: m.by, text: m.label, url: m.url });
    });
  }

  setImpl(number: number, plan: Plan<Proposal, ImplPlan | null>): Written | null {
    return this.write(number, plan, (_p, i, seq, at) => {
      this.q(
        `INSERT INTO proposal_impls (number, head_remote, head_branch, head_key, base_remote,
           base_branch, pr_url, pr_label, pr_key, by, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (number) DO UPDATE SET head_remote = excluded.head_remote,
           head_branch = excluded.head_branch, head_key = excluded.head_key,
           base_remote = excluded.base_remote, base_branch = excluded.base_branch,
           pr_url = excluded.pr_url, pr_label = excluded.pr_label, pr_key = excluded.pr_key,
           by = excluded.by, at = excluded.at`,
      ).run(
        number,
        i.head?.remote ?? null,
        i.head?.branch ?? null,
        i.head === null ? null : refKey(i.head),
        i.base?.remote ?? null,
        i.base?.branch ?? null,
        i.pr?.url ?? null,
        i.pr?.label ?? null,
        i.pr?.key ?? null,
        i.by,
        at,
      );
      // The timeline names it the way a material is named, marked as the impl.
      if (i.pr !== null) {
        this.event(number, seq, at, {
          kind: "material_added",
          by: i.by,
          text: `impl ${i.pr.label}`,
          url: i.pr.url,
        });
      } else if (i.head !== null && i.base !== null) {
        this.event(number, seq, at, {
          kind: "material_added",
          by: i.by,
          text: `impl ${i.head.remote}/${i.head.branch} ← ${i.base.remote}/${i.base.branch}`,
        });
      }
    });
  }

  feedback(
    number: number,
    plan: Plan<Proposal, { text: string; runtime: boolean; by: string }>,
  ): Written {
    return this.must(number, plan, (_p, f, seq, at) => {
      this.event(number, seq, at, {
        kind: f.runtime ? "runtime_feedback" : "feedback",
        by: f.by,
        text: f.text,
      });
    });
  }

  notifyFailed(number: number, plan: Plan<Proposal, { reason: string; by: string }>): Written {
    return this.must(number, plan, (_p, n, seq, at) => {
      this.event(number, seq, at, { kind: "notify_failed", by: n.by, text: n.reason });
    });
  }

  addComment(number: number, plan: Plan<Proposal, CommentPlan>): Written {
    return this.must(number, plan, (_p, c, seq, at) => {
      this.q(
        `INSERT INTO proposal_comments (number, id, ord, by, at, section_id, range_start,
           range_end, revision, paragraph_id, quote, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        number,
        c.id,
        seq,
        c.by,
        at,
        c.sectionId,
        c.range.start,
        c.range.end,
        c.revision,
        c.paragraphId ?? null,
        c.quote,
        c.text,
      );
    });
  }

  editComment(number: number, plan: Plan<Proposal, { id: string; text: string }>): Written {
    return this.must(number, plan, (_p, c) => {
      this.q(`UPDATE proposal_comments SET text = ? WHERE number = ? AND id = ?`).run(
        c.text,
        number,
        c.id,
      );
    });
  }

  deleteComment(number: number, plan: Plan<Proposal, { id: string }>): Written {
    return this.must(number, plan, (_p, c) => {
      this.q(`DELETE FROM proposal_comments WHERE number = ? AND id = ?`).run(number, c.id);
    });
  }

  requestChanges(number: number, plan: Plan<Proposal, BatchPlan>): Written {
    return this.must(number, plan, (p, b, seq, at) => {
      this.q(
        `INSERT INTO proposal_batches (number, id, revision, by, at, open) VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(number, b.id, b.revision, b.by, at);
      const ids = b.commentIds;
      const sent = this.db
        .prepare(
          `UPDATE proposal_comments SET batch_id = ?
            WHERE number = ? AND by = ? AND batch_id IS NULL AND id IN (${ids.map(() => "?").join(", ")})`,
        )
        .run(b.id, number, b.by, ...ids);
      if (Number(sent.changes) !== ids.length) {
        throw new ProposalError(
          409,
          "comments_changed",
          `The pending comments of proposal #${number} changed while they were being sent; reload and send again.`,
        );
      }
      if (b.status !== p.status) {
        this.q(`UPDATE proposals SET status = ? WHERE number = ?`).run(b.status, number);
      }
      this.event(number, seq, at, {
        kind: "changes_requested",
        by: b.by,
        text: String(ids.length),
      });
    });
  }

  resolveComment(
    number: number,
    plan: Plan<Proposal, { id: string; text: string; by: string }>,
  ): Written {
    return this.must(number, plan, (_p, r, seq, at) => {
      this.q(
        `UPDATE proposal_comments SET resolved_by = ?, resolved_at = ?, resolved_text = ?
          WHERE number = ? AND id = ?`,
      ).run(r.by, at, r.text, number, r.id);
      this.event(number, seq, at, { kind: "resolved", by: r.by, text: r.text });
    });
  }

  markRead(userId: string, number: number, seq: number): void {
    this.q(
      `INSERT INTO proposal_reads (user_id, number, seq) VALUES (?, ?, ?)
         ON CONFLICT (user_id, number) DO UPDATE SET seq = max(seq, excluded.seq)`,
    ).run(userId, number, seq);
  }
}
