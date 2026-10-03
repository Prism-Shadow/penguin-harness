/**
 * GraphStore's SQLite adapter, over the same `company.db` connection as the proposal store: the
 * delivery repository's refs as the last probe read them, change request metadata as the last
 * forge read gave it, commit comparisons (immutable: two commits compare the same forever), the
 * laid-out snapshots by their input, the refresher's lease and schedule, and the PR status cache.
 * All of it is derived — the refresher rebuilds any of it.
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { ProposalGraphResponse, ProposalPrStatus } from "@prismshadow/penguin-server/api";
import type { Comparison, ImplPull, OpenPull, ShutPull } from "./pr-chain.js";
import type { GraphStore, PrStatusRow, RefreshState, RefreshWrite, Snapshot } from "./ports.js";
import { immediate } from "./schema.js";

type Row = Record<string, unknown>;

/** Snapshots kept per repository and base. */
export const SNAPSHOTS_KEPT = 20;
/** A comparison unused this long is pruned at a refresh. */
const COMPARISON_TTL_MS = 30 * 24 * 60 * 60_000;

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function comparisonOf(r: Row): Comparison {
  return {
    relation: String(r.relation) as Comparison["relation"],
    ahead: Number(r.ahead),
    behind: Number(r.behind),
    mergeBase: strOrNull(r.merge_base),
    empty: Number(r.empty) === 1,
  };
}

function snapshotOf(r: Row | undefined): Snapshot | null {
  if (r === undefined) return null;
  return {
    inputKey: String(r.input_key),
    builtAt: String(r.built_at),
    checkedAt: String(r.checked_at),
    graph: JSON.parse(String(r.graph)) as ProposalGraphResponse,
  };
}

export class SqliteGraphStore implements GraphStore {
  private readonly cache = new Map<string, StatementSync>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  private q(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private at(): string {
    return new Date(this.now()).toISOString();
  }

  refs(repo: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of this.q(`SELECT ref, oid FROM graph_refs WHERE repo = ?`).all(repo) as Row[]) {
      out.set(String(r.ref), String(r.oid));
    }
    return out;
  }

  openPulls(repo: string): OpenPull[] {
    return (
      this.q(
        `SELECT number, url, title, draft, branch, head, base FROM graph_pulls
          WHERE repo = ? AND state = 'open' ORDER BY number`,
      ).all(repo) as Row[]
    ).map((r) => ({
      number: Number(r.number),
      url: String(r.url),
      title: String(r.title),
      draft: Number(r.draft) === 1,
      branch: String(r.branch),
      head: String(r.head),
      base: String(r.base),
    }));
  }

  shutOn(repo: string, branch: string): ShutPull | null {
    const rows = this.q(
      `SELECT number, state, base, closed_at FROM graph_pulls
        WHERE repo = ? AND branch = ? AND state IN ('merged', 'closed')`,
    ).all(repo, branch) as Row[];
    // The latest merge, else the latest close.
    const latest = (state: string) =>
      rows
        .filter((r) => r.state === state)
        .sort((a, b) => String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? "")))[0];
    const pick = latest("merged") ?? latest("closed");
    return pick === undefined
      ? null
      : {
          number: Number(pick.number),
          state: String(pick.state) as ShutPull["state"],
          base: String(pick.base),
        };
  }

  pull(repo: string, number: number): ImplPull | null {
    const r = this.q(
      `SELECT state, branch, head, base FROM graph_pulls WHERE repo = ? AND number = ?`,
    ).get(repo, number) as Row | undefined;
    return r === undefined
      ? null
      : {
          state: String(r.state) as ImplPull["state"],
          branch: String(r.branch),
          head: String(r.head),
          base: String(r.base),
        };
  }

  comparisons(
    repo: string,
    pairs: ReadonlyArray<readonly [string, string]>,
  ): Map<string, Comparison> {
    const out = new Map<string, Comparison>();
    const s = this.q(
      `SELECT * FROM graph_comparisons WHERE repo = ? AND from_sha = ? AND to_sha = ?`,
    );
    for (const [from, to] of pairs) {
      const r = s.get(repo, from, to) as Row | undefined;
      if (r !== undefined) out.set(`${from}...${to}`, comparisonOf(r));
    }
    return out;
  }

  comparisonsTo(repo: string, commits: readonly string[]): Map<string, Comparison> {
    const out = new Map<string, Comparison>();
    const s = this.q(`SELECT * FROM graph_comparisons WHERE repo = ? AND to_sha = ?`);
    for (const commit of commits) {
      for (const r of s.all(repo, commit) as Row[]) {
        out.set(`${String(r.from_sha)}...${String(r.to_sha)}`, comparisonOf(r));
      }
    }
    return out;
  }

  snapshot(repo: string, base: string, inputKey: string): Snapshot | null {
    return snapshotOf(
      this.q(`SELECT * FROM graph_snapshots WHERE repo = ? AND base = ? AND input_key = ?`).get(
        repo,
        base,
        inputKey,
      ) as Row | undefined,
    );
  }

  latestSnapshot(repo: string, base: string): Snapshot | null {
    return snapshotOf(
      this.q(
        `SELECT * FROM graph_snapshots WHERE repo = ? AND base = ? ORDER BY built_at DESC LIMIT 1`,
      ).get(repo, base) as Row | undefined,
    );
  }

  putSnapshot(repo: string, base: string, inputKey: string, graph: ProposalGraphResponse): void {
    immediate(this.db, () => this.insertSnapshot(repo, base, inputKey, graph, this.at()));
  }

  /**
   * One snapshot per input: a key already stored keeps its row — only its graph is rewritten
   * when the layout changed (a comparison that was missing has been read since).
   */
  private insertSnapshot(
    repo: string,
    base: string,
    inputKey: string,
    graph: ProposalGraphResponse,
    at: string,
  ): void {
    const json = JSON.stringify(graph);
    const found = this.q(
      `SELECT graph FROM graph_snapshots WHERE repo = ? AND base = ? AND input_key = ?`,
    ).get(repo, base, inputKey) as Row | undefined;
    if (found !== undefined) {
      if (String(found.graph) !== json) {
        this.q(
          `UPDATE graph_snapshots SET graph = ?, checked_at = ? WHERE repo = ? AND base = ? AND input_key = ?`,
        ).run(json, at, repo, base, inputKey);
      } else {
        this.q(
          `UPDATE graph_snapshots SET checked_at = ? WHERE repo = ? AND base = ? AND input_key = ?`,
        ).run(at, repo, base, inputKey);
      }
      return;
    }
    this.q(
      `INSERT INTO graph_snapshots (repo, base, input_key, built_at, checked_at, graph)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(repo, base, inputKey, at, at, json);
    this.q(
      `DELETE FROM graph_snapshots WHERE repo = ? AND base = ? AND input_key NOT IN (
         SELECT input_key FROM graph_snapshots WHERE repo = ? AND base = ?
          ORDER BY built_at DESC LIMIT ${SNAPSHOTS_KEPT})`,
    ).run(repo, base, repo, base);
  }

  refreshState(repo: string): RefreshState {
    const r = this.q(`SELECT * FROM graph_refresh WHERE repo = ?`).get(repo) as Row | undefined;
    return {
      holder: strOrNull(r?.holder),
      leaseUntil: strOrNull(r?.lease_until),
      unchanged: Number(r?.unchanged ?? 0),
      nextProbeAt: strOrNull(r?.next_probe_at),
      defaultBranch: strOrNull(r?.default_branch),
      lastOkAt: strOrNull(r?.last_ok_at),
      lastError: strOrNull(r?.last_error),
    };
  }

  acquire(repo: string, holder: string, until: string): boolean {
    return immediate(this.db, () => {
      this.q(`INSERT INTO graph_refresh (repo) VALUES (?) ON CONFLICT (repo) DO NOTHING`).run(repo);
      const r = this.q(
        `UPDATE graph_refresh SET holder = ?, lease_until = ?
          WHERE repo = ? AND (holder IS NULL OR holder = ? OR lease_until IS NULL OR lease_until < ?)`,
      ).run(holder, until, repo, holder, this.at());
      return Number(r.changes) === 1;
    });
  }

  release(repo: string, holder: string): void {
    this.q(
      `UPDATE graph_refresh SET holder = NULL, lease_until = NULL WHERE repo = ? AND holder = ?`,
    ).run(repo, holder);
  }

  probeUnchanged(repo: string, base: string, unchanged: number, nextProbeAt: string): void {
    immediate(this.db, () => {
      const at = this.at();
      this.q(
        `UPDATE graph_snapshots SET checked_at = ? WHERE repo = ? AND base = ? AND input_key = (
           SELECT input_key FROM graph_snapshots WHERE repo = ? AND base = ? ORDER BY built_at DESC LIMIT 1)`,
      ).run(at, repo, base, repo, base);
      this.q(
        `UPDATE graph_refresh SET unchanged = ?, next_probe_at = ?, last_ok_at = ?, last_error = NULL
          WHERE repo = ?`,
      ).run(unchanged, nextProbeAt, at, repo);
    });
  }

  failed(repo: string, error: string, nextProbeAt: string): void {
    this.q(
      `INSERT INTO graph_refresh (repo, last_error, next_probe_at) VALUES (?, ?, ?)
         ON CONFLICT (repo) DO UPDATE SET last_error = excluded.last_error,
           next_probe_at = excluded.next_probe_at`,
    ).run(repo, error, nextProbeAt);
  }

  write(w: RefreshWrite): void {
    immediate(this.db, () => {
      const at = this.at();
      this.q(`DELETE FROM graph_refs WHERE repo = ?`).run(w.repo);
      const ref = this.q(`INSERT INTO graph_refs (repo, ref, oid, read_at) VALUES (?, ?, ?, ?)`);
      for (const [name, oid] of w.refs) ref.run(w.repo, name, oid, at);
      // An open list read whole replaces the open rows it covers: a PR missing from it is no
      // longer open (it is read again as merged or closed when the graph walks through it).
      for (const repo of w.openOf) {
        this.q(`DELETE FROM graph_pulls WHERE repo = ? AND state = 'open'`).run(repo);
      }
      const pull = this.q(
        `INSERT INTO graph_pulls (repo, number, state, branch, head, base, draft, url, closed_at, title, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo, number) DO UPDATE SET state = excluded.state, branch = excluded.branch,
           head = excluded.head, base = excluded.base, draft = excluded.draft, url = excluded.url,
           closed_at = excluded.closed_at, title = excluded.title, read_at = excluded.read_at`,
      );
      const status = this.q(
        `INSERT INTO pr_status (key, status, base, default_branch, checked_at, error)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT (key) DO UPDATE SET status = excluded.status, base = excluded.base,
           default_branch = excluded.default_branch, checked_at = excluded.checked_at, error = NULL`,
      );
      for (const cr of w.pulls) {
        pull.run(
          cr.repo,
          cr.number,
          cr.state,
          cr.branch,
          cr.head,
          cr.base,
          cr.draft ? 1 : 0,
          cr.url,
          cr.closedAt,
          cr.title,
          at,
        );
        const prStatus: ProposalPrStatus =
          cr.state === "open" ? (cr.draft ? "draft" : "open") : cr.state;
        status.run(
          `${cr.repo.toLowerCase()}#${cr.number}`,
          prStatus,
          cr.base,
          cr.defaultBranch,
          at,
        );
      }
      const cmp = this.q(
        `INSERT INTO graph_comparisons (repo, from_sha, to_sha, relation, ahead, behind, merge_base, empty, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo, from_sha, to_sha) DO UPDATE SET used_at = excluded.used_at`,
      );
      for (const { from, to, cmp: c } of w.comparisons) {
        cmp.run(w.repo, from, to, c.relation, c.ahead, c.behind, c.mergeBase, c.empty ? 1 : 0, at);
      }
      this.touchComparisons(w.repo, w.used, at);
      this.q(`DELETE FROM graph_comparisons WHERE repo = ? AND used_at < ?`).run(
        w.repo,
        new Date(this.now() - COMPARISON_TTL_MS).toISOString(),
      );
      if (w.snapshot !== null) {
        this.insertSnapshot(w.repo, w.snapshot.base, w.snapshot.inputKey, w.snapshot.graph, at);
      }
      this.q(`INSERT INTO graph_refresh (repo) VALUES (?) ON CONFLICT (repo) DO NOTHING`).run(
        w.repo,
      );
      this.q(
        `UPDATE graph_refresh SET unchanged = ?, next_probe_at = ?, default_branch = coalesce(?, default_branch),
           last_ok_at = ?, last_error = NULL WHERE repo = ?`,
      ).run(w.unchanged, w.nextProbeAt, w.defaultBranch, at, w.repo);
    });
  }

  /** Marks comparisons as used (a read laid out with them), so the pruning keeps them. */
  private touchComparisons(
    repo: string,
    pairs: ReadonlyArray<readonly [string, string]>,
    at: string,
  ): void {
    const s = this.q(
      `UPDATE graph_comparisons SET used_at = ? WHERE repo = ? AND from_sha = ? AND to_sha = ?`,
    );
    for (const [from, to] of pairs) s.run(at, repo, from, to);
  }

  prStatuses(keys: readonly string[]): Map<string, PrStatusRow> {
    const out = new Map<string, PrStatusRow>();
    if (keys.length === 0) return out;
    const rows = this.db
      .prepare(`SELECT * FROM pr_status WHERE key IN (${keys.map(() => "?").join(", ")})`)
      .all(...keys) as Row[];
    for (const r of rows) {
      out.set(String(r.key), {
        key: String(r.key),
        status: strOrNull(r.status) as ProposalPrStatus | null,
        base: strOrNull(r.base),
        defaultBranch: strOrNull(r.default_branch),
        checkedAt: String(r.checked_at),
        error: strOrNull(r.error),
      });
    }
    return out;
  }

  putPrStatuses(rows: readonly PrStatusRow[]): void {
    if (rows.length === 0) return;
    immediate(this.db, () => {
      const s = this.q(
        `INSERT INTO pr_status (key, status, base, default_branch, checked_at, error)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET status = coalesce(excluded.status, pr_status.status),
           base = coalesce(excluded.base, pr_status.base),
           default_branch = coalesce(excluded.default_branch, pr_status.default_branch),
           checked_at = excluded.checked_at, error = excluded.error`,
      );
      for (const r of rows) s.run(r.key, r.status, r.base, r.defaultBranch, r.checkedAt, r.error);
    });
  }
}
