/**
 * RoadmapStore's SQLite adapter. A roadmap is its header row (with the current draft's record
 * and body), its items in order, its delegations with the approvals given on each one's current
 * brief, its room sessions and its events — each a query by number, no history folded. A write
 * is one `BEGIN IMMEDIATE` transaction: the check (guards.ts) on the roadmap as it stands, the
 * rows it changes, one event.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  RoadmapError,
  type Clone,
  type Delegation,
  type DraftItem,
  type Roadmap,
  type RoadmapEvent,
  type RoadmapStatus,
  type RoadmapWrite,
} from "./domain.js";
import type { RoadmapStore } from "./ports.js";
import { immediate, openCompanyDb } from "./schema.js";

type Row = Record<string, unknown>;

/** The hash an approval is bound to: an approval counts for the brief it was given on. */
export function briefSha(brief: string): string {
  return createHash("sha256").update(brief).digest("hex");
}

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** What an event says beside its kind, for the timeline. */
function noteOf(w: RoadmapWrite): string | undefined {
  switch (w.kind) {
    case "opened":
      return w.channelId ?? undefined;
    case "room":
      return w.channelId;
    case "delegated":
      return w.child !== null ? `${w.key} → roadmap #${w.child}` : `${w.key} → ${w.owner}`;
    case "briefed":
      return `${w.key}: brief (${w.owner})`;
    case "approved":
      return `${w.key}: ${w.role} ${w.by}`;
    case "linked":
      return `${w.key} → proposal #${w.proposal}`;
    case "adopted":
      return `${w.item.key} ← proposal #${w.item.proposal ?? "?"}`;
    case "reopened":
      return w.reason;
    case "renamed":
      return w.name;
    case "clone":
    case "clone_closed":
      return `${w.agentId} ${w.sessionId}`;
    case "notify_failed":
      return `${w.agentId}: ${w.error}`;
    default:
      return undefined;
  }
}

function itemOf(r: Row): DraftItem {
  const base = {
    key: String(r.key),
    title: String(r.title),
    brief: String(r.brief),
    cites: JSON.parse(String(r.cites)) as string[],
  };
  if (r.kind === "roadmap") {
    return { ...base, kind: "roadmap", employees: JSON.parse(String(r.employees)) as string[] };
  }
  return {
    ...base,
    kind: "proposal",
    owner: String(r.owner),
    ...(r.stack === "none"
      ? { stackedOn: null }
      : r.stack === "item"
        ? { stackedOn: String(r.stacked_on) }
        : {}),
    ...(r.proposal !== null ? { proposal: Number(r.proposal) } : {}),
  };
}

export class SqliteRoadmapStore implements RoadmapStore {
  private readonly cache = new Map<string, StatementSync>();
  /** Called inside every write transaction of this view: an Action run's start row (scoped). */
  private sink: ((db: DatabaseSync) => void) | null = null;

  constructor(
    readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * A view of this store whose every write transaction also calls `sink` before it commits —
   * the run's start row, so the run and its write commit together.
   */
  scoped(sink: ((db: DatabaseSync) => void) | undefined): SqliteRoadmapStore {
    if (sink === undefined) return this;
    const view = Object.create(this) as SqliteRoadmapStore;
    view.sink = sink;
    return view;
  }

  static open(file: string, now?: () => number): SqliteRoadmapStore {
    return new SqliteRoadmapStore(openCompanyDb(file), now);
  }

  close(): void {
    this.db.close();
  }

  private q(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  list(filter: { channel?: string; status?: RoadmapStatus } = {}): Roadmap[] {
    const heads = (this.q(`SELECT * FROM roadmaps ORDER BY number`).all() as Row[]).filter(
      (r) =>
        (filter.channel === undefined || r.channel_id === filter.channel) &&
        (filter.status === undefined || r.status === filter.status),
    );
    return this.assemble(heads, null);
  }

  get(number: number): Roadmap | null {
    const head = this.q(`SELECT * FROM roadmaps WHERE number = ?`).get(number) as Row | undefined;
    return head === undefined ? null : this.assemble([head], number)[0]!;
  }

  nextNumber(): number {
    const r = this.q(`SELECT max(number) AS n FROM roadmaps`).get() as { n: number | null };
    return Number(r.n ?? 0) + 1;
  }

  discussingIn(channelId: string): number | null {
    const r = this.q(
      `SELECT number FROM roadmaps WHERE channel_id = ? AND status = 'discussing' ORDER BY number LIMIT 1`,
    ).get(channelId) as Row | undefined;
    return r === undefined ? null : Number(r.number);
  }

  /** The roadmaps of these header rows; `one` narrows every dependent query to that number. */
  private assemble(heads: Row[], one: number | null): Roadmap[] {
    const where = one === null ? "" : "WHERE number = ?";
    const args = one === null ? [] : [one];
    const group = <T>(rows: Row[], f: (r: Row) => T): Map<number, T[]> => {
      const out = new Map<number, T[]>();
      for (const r of rows) {
        const n = Number(r.number);
        const list = out.get(n) ?? [];
        list.push(f(r));
        out.set(n, list);
      }
      return out;
    };
    const items = group(
      this.q(`SELECT * FROM roadmap_items ${where} ORDER BY number, position`).all(
        ...args,
      ) as Row[],
      itemOf,
    );
    const clones = group(
      this.q(`SELECT * FROM roadmap_clones ${where} ORDER BY number, opened_at, rowid`).all(
        ...args,
      ) as Row[],
      (r): Clone => ({
        agentId: String(r.agent_id),
        sessionId: String(r.session_id),
        openedAt: String(r.opened_at),
        ...(r.closed_at !== null ? { closedAt: String(r.closed_at) } : {}),
      }),
    );
    const events = group(
      this.q(`SELECT * FROM roadmap_events ${where} ORDER BY number, seq`).all(...args) as Row[],
      (r): RoadmapEvent => ({
        seq: Number(r.seq),
        at: String(r.at),
        by: String(r.by),
        kind: String(r.kind) as RoadmapEvent["kind"],
        ...(r.note !== null ? { note: String(r.note) } : {}),
      }),
    );
    const approvals = new Map<string, Delegation["approvals"]>();
    for (const r of this.q(
      `SELECT a.number, a.key, a.role, a.by, a.at FROM roadmap_approvals a
         JOIN roadmap_delegations d ON d.number = a.number AND d.key = a.key AND d.brief_sha = a.brief_sha
        ${one === null ? "" : "WHERE a.number = ?"} ORDER BY a.at`,
    ).all(...args) as Row[]) {
      const k = `${String(r.number)}/${String(r.key)}`;
      const got = approvals.get(k) ?? {};
      got[String(r.role)] = { by: String(r.by), at: String(r.at) };
      approvals.set(k, got);
    }
    const delegations = group(
      this.q(`SELECT * FROM roadmap_delegations ${where} ORDER BY number`).all(...args) as Row[],
      (r): Delegation => ({
        key: String(r.key),
        owner: String(r.owner),
        brief: String(r.brief),
        base: strOrNull(r.base),
        child: r.child === null ? null : Number(r.child),
        delivered: Number(r.delivered) === 1,
        ...(r.error !== null ? { error: String(r.error) } : {}),
        ...(r.proposal !== null ? { proposal: Number(r.proposal) } : {}),
        stage: String(r.stage) as Delegation["stage"],
        approvals: approvals.get(`${String(r.number)}/${String(r.key)}`) ?? {},
      }),
    );
    return heads.map((h) => {
      const n = Number(h.number);
      return {
        number: n,
        name: String(h.name),
        brief: String(h.brief),
        channelId: strOrNull(h.channel_id),
        employees: JSON.parse(String(h.employees)) as string[],
        parent: h.parent === null ? null : Number(h.parent),
        parentItem: strOrNull(h.parent_item),
        status: String(h.status) as RoadmapStatus,
        record: String(h.record),
        body: String(h.body),
        items: items.get(n) ?? [],
        clones: clones.get(n) ?? [],
        delegations: Object.fromEntries((delegations.get(n) ?? []).map((d) => [d.key, d])),
        createdBy: String(h.created_by),
        createdAt: String(h.created_at),
        events: events.get(n) ?? [],
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  private nextSeq(): number {
    const r = this.q(
      `INSERT INTO roadmap_seq (id, value) VALUES (1, 1)
         ON CONFLICT (id) DO UPDATE SET value = value + 1 RETURNING value`,
    ).get() as { value: number };
    return Number(r.value);
  }

  write(entries: RoadmapWrite | readonly RoadmapWrite[], check?: (r: Roadmap) => void): Roadmap {
    const list: readonly RoadmapWrite[] = Array.isArray(entries)
      ? entries
      : [entries as RoadmapWrite];
    const first = list[0]!;
    immediate(this.db, () => {
      const at = new Date(this.now()).toISOString();
      if (first.kind !== "opened") {
        const r = this.get(first.number);
        if (r === null) {
          throw new RoadmapError(404, "roadmap_not_found", `No roadmap #${first.number}.`);
        }
        check?.(r);
      }
      for (const w of list) {
        const seq = this.nextSeq();
        this.apply(w, seq, at);
        this.q(`UPDATE roadmaps SET updated_at = ?, seq = ? WHERE number = ?`).run(
          at,
          seq,
          w.number,
        );
        this.q(
          `INSERT INTO roadmap_events (seq, number, at, by, kind, note) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(seq, w.number, at, w.by, w.kind, noteOf(w) ?? null);
      }
      this.sink?.(this.db);
    });
    return this.get(first.number)!;
  }

  recordDelivery(number: number, key: string, delivered: boolean, error: string | null): void {
    this.q(
      `UPDATE roadmap_delegations SET delivered = ?, error = ? WHERE number = ? AND key = ?`,
    ).run(delivered ? 1 : 0, error, number, key);
  }

  private apply(w: RoadmapWrite, seq: number, at: string): void {
    switch (w.kind) {
      case "opened":
        this.q(
          `INSERT INTO roadmaps (number, name, status, channel_id, parent, parent_item, employees,
             created_by, created_at, updated_at, seq, brief)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          w.number,
          w.name,
          w.channelId === null ? "awaiting_room" : "discussing",
          w.channelId,
          w.parent,
          w.parentItem ?? null,
          JSON.stringify(w.employees),
          w.by,
          at,
          at,
          seq,
          w.brief,
        );
        return;
      case "room":
        this.q(
          `UPDATE roadmaps SET channel_id = ?,
             status = CASE status WHEN 'awaiting_room' THEN 'discussing' ELSE status END
           WHERE number = ?`,
        ).run(w.channelId, w.number);
        return;
      case "draft":
        this.q(
          `INSERT INTO roadmap_drafts (number, seq, by, at, record, body, items) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          w.number,
          seq,
          w.by,
          at,
          w.record ?? null,
          w.body ?? null,
          w.items === undefined ? null : JSON.stringify(w.items),
        );
        if (w.record !== undefined) {
          this.q(`UPDATE roadmaps SET record = ? WHERE number = ?`).run(w.record, w.number);
        }
        if (w.body !== undefined) {
          this.q(`UPDATE roadmaps SET body = ? WHERE number = ?`).run(w.body, w.number);
        }
        if (w.items !== undefined) {
          this.q(`DELETE FROM roadmap_items WHERE number = ?`).run(w.number);
          w.items.forEach((item, i) => this.insertItem(w.number, item, i));
        }
        return;
      case "established":
        this.q(`UPDATE roadmaps SET status = 'established' WHERE number = ?`).run(w.number);
        return;
      case "reopened":
        this.q(`UPDATE roadmaps SET status = 'discussing' WHERE number = ?`).run(w.number);
        return;
      case "renamed":
        this.q(`UPDATE roadmaps SET name = ? WHERE number = ?`).run(w.name, w.number);
        return;
      case "delegated":
      case "briefed": {
        const prior = this.q(
          `SELECT owner, proposal FROM roadmap_delegations WHERE number = ? AND key = ?`,
        ).get(w.number, w.key) as Row | undefined;
        // A delegation to the same owner keeps the proposal it already linked.
        const proposal =
          prior !== undefined && prior.proposal !== null && prior.owner === w.owner
            ? Number(prior.proposal)
            : null;
        const delegated = w.kind === "delegated";
        this.q(
          `INSERT INTO roadmap_delegations (number, key, owner, stage, base, child, proposal,
             delivered, error, brief_sha, brief)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (number, key) DO UPDATE SET owner = excluded.owner, stage = excluded.stage,
             base = excluded.base, child = excluded.child, proposal = excluded.proposal,
             delivered = excluded.delivered, error = excluded.error,
             brief_sha = excluded.brief_sha, brief = excluded.brief`,
        ).run(
          w.number,
          w.key,
          w.owner,
          delegated ? "delegated" : "brief",
          w.base,
          delegated ? w.child : null,
          proposal,
          delegated && w.delivered ? 1 : 0,
          delegated ? (w.error ?? null) : null,
          briefSha(w.brief),
          w.brief,
        );
        return;
      }
      case "approved":
        this.q(
          `INSERT INTO roadmap_approvals (number, key, brief_sha, role, by, at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(w.number, w.key, briefSha(w.brief), w.role, w.by, at);
        return;
      case "linked":
        this.q(`UPDATE roadmap_delegations SET proposal = ? WHERE number = ? AND key = ?`).run(
          w.proposal,
          w.number,
          w.key,
        );
        return;
      case "adopted": {
        // Taken in after the items as they stand (in place of an item of the same key).
        this.q(`DELETE FROM roadmap_items WHERE number = ? AND key = ?`).run(w.number, w.item.key);
        const max = this.q(`SELECT max(position) AS p FROM roadmap_items WHERE number = ?`).get(
          w.number,
        ) as { p: number | null };
        this.insertItem(w.number, w.item, Number(max.p ?? -1) + 1);
        return;
      }
      case "clone":
        this.q(
          `INSERT INTO roadmap_clones (session_id, number, agent_id, opened_at) VALUES (?, ?, ?, ?)`,
        ).run(w.sessionId, w.number, w.agentId, at);
        return;
      case "clone_closed":
        this.q(
          `UPDATE roadmap_clones SET closed_at = ? WHERE session_id = ? AND number = ? AND closed_at IS NULL`,
        ).run(at, w.sessionId, w.number);
        return;
      case "notify_failed":
        return;
    }
  }

  private insertItem(number: number, item: DraftItem, position: number): void {
    const proposal = item.kind === "proposal";
    const stack =
      !proposal || item.stackedOn === undefined
        ? "previous"
        : item.stackedOn === null
          ? "none"
          : "item";
    this.q(
      `INSERT INTO roadmap_items (number, key, position, kind, title, owner, employees, cites,
         stack, stacked_on, proposal, brief)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      number,
      item.key,
      position,
      item.kind,
      item.title,
      proposal ? item.owner : null,
      proposal ? null : JSON.stringify(item.employees),
      JSON.stringify(item.cites),
      stack,
      stack === "item" && proposal ? (item.stackedOn ?? null) : null,
      proposal ? (item.proposal ?? null) : null,
      item.brief,
    );
  }
}
