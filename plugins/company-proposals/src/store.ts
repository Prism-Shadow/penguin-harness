/**
 * ProposalStore's SQLite adapter, its read side: every read path is one to a few prepared
 * statements over the indexes schema.ts declares — the queue, one proposal, its revisions, the
 * unread counts — and nothing is folded from a history. The writes are in store-write.ts.
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  ProposalComment,
  ProposalCommentTarget,
  ProposalDiscussion,
  ProposalEvent,
  ProposalMaterial,
  ProposalMaterialKind,
  ProposalRevision,
  ProposalScopeKind,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import type { Proposal, ProposalImpl } from "./domain.js";
import type { ProposalFacts, ProposalSummary, ProposalTx, Viewer } from "./ports.js";

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);

/** The impl columns of a `proposal_impls` row, as the domain names them. */
export function implOf(row: Row | undefined): ProposalImpl | null {
  if (row === undefined) return null;
  const headRemote = strOrNull(row.head_remote);
  const baseRemote = strOrNull(row.base_remote);
  const prUrl = strOrNull(row.pr_url);
  return {
    head:
      headRemote === null
        ? null
        : { remote: headRemote, repo: str(row.head_repo), branch: str(row.head_branch) },
    base:
      baseRemote === null
        ? null
        : { remote: baseRemote, repo: str(row.base_repo), branch: str(row.base_branch) },
    pr: prUrl === null ? null : { url: prUrl, label: str(row.pr_label ?? prUrl) },
    by: str(row.by),
    at: str(row.at),
  };
}

function materialOf(row: Row): ProposalMaterial {
  return {
    kind: str(row.kind) as ProposalMaterialKind,
    label: str(row.label),
    url: str(row.url),
    by: str(row.by),
    at: str(row.at),
  };
}

function eventOf(row: Row): ProposalEvent {
  return {
    seq: num(row.seq),
    at: str(row.at),
    kind: str(row.kind) as ProposalEvent["kind"],
    by: str(row.by),
    ...(row.text !== null ? { text: str(row.text) } : {}),
    ...(row.revision !== null ? { revision: num(row.revision) } : {}),
    ...(row.url !== null ? { url: str(row.url) } : {}),
  };
}

/** The target columns of a `proposal_comments` row; undefined for a comment on a passage. */
function targetOf(row: Row): ProposalCommentTarget | undefined {
  const kind = strOrNull(row.target_kind);
  if (kind === null) return undefined;
  const path = str(row.target_path);
  switch (kind) {
    case "scope":
      return { kind, file: path, scopeKind: str(row.target_scope_kind) as ProposalScopeKind };
    case "test":
      return { kind, file: path };
    case "change-file":
      return { kind, path, headSha: str(row.target_head), baseSha: str(row.target_base) };
    default:
      return {
        kind: "change-lines",
        path,
        side: str(row.target_side) === "old" ? "old" : "new",
        start: num(row.target_start),
        end: num(row.target_end),
        headSha: str(row.target_head),
        baseSha: str(row.target_base),
      };
  }
}

export function commentOf(row: Row): ProposalComment {
  const target = targetOf(row);
  return {
    id: str(row.id),
    ...(target !== undefined ? { target } : {}),
    sectionId: str(row.section_id),
    range: { start: num(row.range_start), end: num(row.range_end) },
    quote: str(row.quote),
    ...(row.paragraph_id !== null ? { paragraphId: str(row.paragraph_id) } : {}),
    revision: num(row.revision),
    text: str(row.text),
    by: str(row.by),
    at: str(row.at),
    batchId: strOrNull(row.batch_id),
    ...(row.resolved_by !== null
      ? {
          resolved: {
            by: str(row.resolved_by),
            at: str(row.resolved_at),
            text: str(row.resolved_text ?? ""),
          },
        }
      : {}),
  };
}

function revisionOf(row: Row): ProposalRevision {
  return {
    revision: num(row.revision),
    title: str(row.title),
    root: str(row.root),
    scope: JSON.parse(str(row.scope)) as ProposalRevision["scope"],
    tests: JSON.parse(str(row.tests)) as ProposalRevision["tests"],
    sections: JSON.parse(str(row.sections)) as ProposalRevision["sections"],
    by: str(row.by),
    at: str(row.at),
  };
}

/**
 * The read paths' statements that carry the volume, named so a test can hold their query plans
 * to the indexes schema.ts declares.
 */
export const READS = {
  /** The queue for a reader (a person or an employee): the unread count is a range scan of proposal_events_by_number. */
  queue: `SELECT p.number, p.status, p.revision, p.author, p.implementer, p.delegated_by,
      p.created_at, p.updated_at, p.title, (SELECT count(*) FROM proposal_events e
        WHERE e.number = p.number AND e.seq > coalesce(r.seq, 0) AND e.by <> :me) AS unread
     FROM proposals p LEFT JOIN proposal_reads r ON r.user_id = :user AND r.number = p.number
     ORDER BY p.number DESC`,
  pendingCounts: `SELECT number, count(*) AS n FROM proposal_comments
     WHERE by = ? AND batch_id IS NULL GROUP BY number`,
  headRevision: `SELECT root, scope, tests, sections FROM proposal_revisions WHERE number = ? AND revision = ?`,
  revisionList: `SELECT revision, by, at FROM proposal_revisions WHERE number = ? ORDER BY revision`,
  revision: `SELECT * FROM proposal_revisions WHERE number = ? AND revision = ?`,
  events: `SELECT * FROM proposal_events WHERE number = ? ORDER BY seq`,
  materials: `SELECT kind, label, url, by, at FROM proposal_materials WHERE number = ? ORDER BY id`,
  comments: `SELECT * FROM proposal_comments WHERE number = ? ORDER BY ord`,
  sessions: `SELECT * FROM proposal_sessions WHERE number = ? ORDER BY at, rowid`,
  implByPr: `SELECT number FROM proposal_impls WHERE pr_key = ?`,
  implByHead: `SELECT i.number, p.status FROM proposal_impls i JOIN proposals p ON p.number = i.number
     WHERE i.head_key = ?`,
  implOnHeadBranch: `SELECT i.number, p.status, i.head_repo AS repo FROM proposal_impls i
     JOIN proposals p ON p.number = i.number WHERE i.head_branch = ?`,
  implOnBaseBranch: `SELECT i.number, p.status, i.base_repo AS repo FROM proposal_impls i
     JOIN proposals p ON p.number = i.number WHERE i.base_branch = ?`,
} as const;

/** The statements of the read paths, prepared once per connection. */
export class ProposalReads {
  private readonly cache = new Map<string, StatementSync>();

  constructor(readonly db: DatabaseSync) {}

  /** A prepared statement, prepared on first use. */
  protected q(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  list(viewer: Viewer): ProposalSummary[] {
    const rows = this.q(READS.queue).all({ me: viewer.principal, user: viewer.reader }) as Row[];
    const pending = new Map<number, number>();
    for (const r of this.q(READS.pendingCounts).all(viewer.principal) as Row[]) {
      pending.set(num(r.number), num(r.n));
    }
    const materials = new Map<number, ProposalMaterial[]>();
    for (const r of this.q(
      `SELECT number, kind, label, url, by, at FROM proposal_materials ORDER BY number, id`,
    ).all() as Row[]) {
      const list = materials.get(num(r.number)) ?? [];
      list.push(materialOf(r));
      materials.set(num(r.number), list);
    }
    const impls = new Map<number, ProposalImpl>();
    for (const r of this.q(`SELECT * FROM proposal_impls`).all() as Row[]) {
      impls.set(num(r.number), implOf(r)!);
    }
    return rows.map((r) => ({
      number: num(r.number),
      title: str(r.title),
      status: str(r.status) as ProposalStatus,
      revision: num(r.revision),
      author: str(r.author),
      implementer: strOrNull(r.implementer),
      delegatedBy: str(r.delegated_by),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      unread: num(r.unread),
      pendingComments: pending.get(num(r.number)) ?? 0,
      materials: materials.get(num(r.number)) ?? [],
      impl: impls.get(num(r.number)) ?? null,
    }));
  }

  get(number: number): Proposal | null {
    const h = this.q(`SELECT * FROM proposals WHERE number = ?`).get(number) as Row | undefined;
    if (h === undefined) return null;
    const revision = num(h.revision);
    const head =
      revision === 0
        ? undefined
        : (this.q(READS.headRevision).get(number, revision) as Row | undefined);
    const sessions = this.q(READS.sessions).all(number) as Row[];
    const comments = (this.q(READS.comments).all(number) as Row[]).map(commentOf);
    const batches = this.q(
      `SELECT id, revision FROM proposal_batches WHERE number = ? AND open = 1 ORDER BY at, id`,
    ).all(number) as Row[];
    return {
      number,
      title: str(h.title),
      status: str(h.status) as ProposalStatus,
      revision,
      author: str(h.author),
      implementer: strOrNull(h.implementer),
      delegatedBy: str(h.delegated_by),
      brief: str(h.brief),
      createdAt: str(h.created_at),
      updatedAt: str(h.updated_at),
      root: head === undefined ? "" : str(head.root),
      scope: head === undefined ? [] : (JSON.parse(str(head.scope)) as Proposal["scope"]),
      tests: head === undefined ? [] : (JSON.parse(str(head.tests)) as Proposal["tests"]),
      sections: head === undefined ? [] : (JSON.parse(str(head.sections)) as Proposal["sections"]),
      materials: (this.q(READS.materials).all(number) as Row[]).map(materialOf),
      impl: implOf(
        this.q(`SELECT * FROM proposal_impls WHERE number = ?`).get(number) as Row | undefined,
      ),
      sessions: sessions.filter((s) => s.kind === "implementation").map((s) => str(s.session_id)),
      discussions: sessions
        .filter((s) => s.kind === "discussion")
        .map((s): ProposalDiscussion => ({
          sessionId: str(s.session_id),
          agentId: str(s.agent_id),
          by: str(s.by),
          at: str(s.at),
          concluded:
            s.concluded_by === null
              ? null
              : {
                  by: str(s.concluded_by),
                  at: str(s.concluded_at),
                  text: str(s.conclusion ?? ""),
                },
        })),
      comments,
      events: (this.q(READS.events).all(number) as Row[]).map(eventOf),
      openBatches: batches.map((b) => ({
        id: str(b.id),
        revision: num(b.revision),
        commentIds: comments.filter((c) => c.batchId === str(b.id)).map((c) => c.id),
      })),
      approvedRevision: h.approved_revision === null ? null : num(h.approved_revision),
      roadmap:
        h.roadmap_number === null
          ? null
          : { number: num(h.roadmap_number), key: str(h.roadmap_key) },
      seq: num(h.seq),
    };
  }

  exists(number: number): boolean {
    return this.q(`SELECT 1 FROM proposals WHERE number = ?`).get(number) !== undefined;
  }

  /** A reader's position on a proposal: the last seq they saw, 0 for none. */
  readSeq(userId: string, number: number): number {
    const r = this.q(`SELECT seq FROM proposal_reads WHERE user_id = ? AND number = ?`).get(
      userId,
      number,
    ) as Row | undefined;
    return r === undefined ? 0 : num(r.seq);
  }

  revisions(number: number): Array<{ revision: number; by: string; at: string }> {
    return (this.q(READS.revisionList).all(number) as Row[]).map((r) => ({
      revision: num(r.revision),
      by: str(r.by),
      at: str(r.at),
    }));
  }

  revision(number: number, revision: number): ProposalRevision | null {
    const row = this.q(READS.revision).get(number, revision) as Row | undefined;
    return row === undefined ? null : revisionOf(row);
  }

  facts(): ProposalFacts[] {
    const roots = new Map<number, string>();
    for (const r of this.q(
      `SELECT p.number, v.root FROM proposals p
         JOIN proposal_revisions v ON v.number = p.number AND v.revision = p.revision`,
    ).all() as Row[]) {
      roots.set(num(r.number), str(r.root));
    }
    const impls = new Map<number, ProposalImpl>();
    for (const r of this.q(`SELECT * FROM proposal_impls`).all() as Row[]) {
      impls.set(num(r.number), implOf(r)!);
    }
    const prs = new Map<number, string[]>();
    for (const r of this.q(
      `SELECT number, url FROM proposal_materials WHERE kind = 'pr' ORDER BY number, id`,
    ).all() as Row[]) {
      prs.set(num(r.number), [...(prs.get(num(r.number)) ?? []), str(r.url)]);
    }
    return (
      this.q(`SELECT number, title, status FROM proposals ORDER BY number`).all() as Row[]
    ).map((r) => ({
      number: num(r.number),
      title: str(r.title),
      status: str(r.status) as ProposalStatus,
      root: roots.get(num(r.number)) ?? "",
      impl: impls.get(num(r.number)) ?? null,
      prMaterials: prs.get(num(r.number)) ?? [],
    }));
  }

  /** The lookups a plan may make inside a write transaction. */
  protected tx(): ProposalTx {
    return {
      implsByPr: (prKey) => (this.q(READS.implByPr).all(prKey) as Row[]).map((r) => num(r.number)),
      implsByHead: (headKey) =>
        (this.q(READS.implByHead).all(headKey) as Row[]).map((r) => ({
          number: num(r.number),
          status: str(r.status) as ProposalStatus,
        })),
      implsOnBranch: (side, branch) =>
        (
          this.q(side === "head" ? READS.implOnHeadBranch : READS.implOnBaseBranch).all(
            branch,
          ) as Row[]
        ).map((r) => ({
          number: num(r.number),
          status: str(r.status) as ProposalStatus,
          repo: str(r.repo),
        })),
    };
  }
}
