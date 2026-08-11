/**
 * Trace-file index: keeps the trace_files / trace_sessions derived cache in step with
 * the on-disk Trace tree so hot request paths never walk directories or head-read
 * files. The DISK remains the single source of truth — every row is rebuildable, and
 * the cache is never authority for absence (consumers force-reconcile and retry on a
 * miss before erroring).
 *
 * Keeping in step happens on three paths:
 *   - Write-time registration: server paths that create/delete shards with known
 *     identities register synchronously (trace import via registerImportedFile;
 *     Session delete via removeSession). Server task runs write through core's Trace
 *     Writer without telling the server which shard rotated — those land via the
 *     reconciler like external writes (the run bumps the date-dir mtime).
 *   - mtime-gated reconciliation (reconcileAgent): the hot path stats the Agent's
 *     traces root plus its newest known date dir (TWO stat calls, no readdir; a new
 *     date dir bumps the root's mtime, a new file in the current date dir bumps that
 *     dir's mtime). Only on a change does it readdir — and only the date dirs whose
 *     mtime moved — registering new shards and classifying each new Session ONCE
 *     (bounded head-read of the earliest shard for origin/workspace/title). Restart
 *     forgets the in-memory gate, so the first request per Agent after an upgrade or
 *     restart runs one full diff (this is also how the index first populates: no
 *     migration step needed).
 *   - Forced reconciliation (`force`): ignores the gate and diffs every date dir —
 *     the miss-retry path for gate blind spots (e.g. an external write into an OLD
 *     date dir moves neither gated mtime). A stale index therefore degrades to one
 *     extra scan, never to a false 404.
 *
 * Single-flight per Agent: concurrent requests share one in-flight reconcile instead
 * of stampeding the directory.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { agentsDir, isSessionMeta, tracesDir } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { TraceFileRow, TraceSessionRow } from "../db/repos/trace-index.js";
import { TraceIndexRepo } from "../db/repos/trace-index.js";
import { cacheable, statMtime } from "../internal/mtime-gate.js";
import { readTraceHead } from "../internal/trace-head.js";
import { asSessionSource } from "../runtime/session-sources.js";
import type { SessionSources } from "../runtime/session-sources.js";
import { fallbackTitle } from "../runtime/title-generator.js";

const TRACE_FILE_RE = /^(.+)_(\d{3})\.jsonl$/;

/** Absolute path of an indexed shard (reconstructed — rows never store paths; the data root may move). */
export function traceFilePath(root: string, row: TraceFileRow): string {
  const name = `${row.sessionId}_${String(row.fileIndex).padStart(3, "0")}.jsonl`;
  return path.join(tracesDir(root, row.projectId, row.agentId), row.date, name);
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Session facts extracted from a shard's records (registration-time classification). */
function factsFromRecords(
  projectId: string,
  agentId: string,
  sessionId: string,
  records: OmniMessage[],
): TraceSessionRow {
  const meta = records.find(isSessionMeta);
  let firstPrompt: string | null = null;
  for (const msg of records) {
    if (msg.type !== "model_msg") continue;
    const p = msg.payload as { type?: string; role?: string; text?: string };
    if (p.type === "text" && p.role === "user" && typeof p.text === "string") {
      firstPrompt = p.text;
      break;
    }
  }
  return {
    sessionId,
    projectId,
    agentId,
    source: meta ? (asSessionSource(meta.payload.source) ?? null) : null,
    workspace: meta && typeof meta.payload.workspace === "string" ? meta.payload.workspace : "",
    title: firstPrompt !== null ? fallbackTitle(firstPrompt) : null,
    provider: meta && typeof meta.payload.provider === "string" ? meta.payload.provider : null,
    modelId: meta && typeof meta.payload.model_id === "string" ? meta.payload.model_id : null,
    firstTs: records[0]?.timestamp ?? null,
    metaRead: meta !== undefined,
  };
}

/** In-memory reconcile gate of one Agent: last seen mtimes (traces root + per date dir). */
interface SeenDirs {
  root: number;
  dates: Map<string, number>;
}

export class TraceIndexService {
  private readonly seen = new Map<string, SeenDirs>();
  private readonly inflight = new Map<string, Promise<void>>();
  /**
   * Test observability (asserting the hot path stays readdir/head-read free):
   * gateStats = gate stat calls, dirScans = date-dir readdir passes, headReads =
   * registration-time classification reads.
   */
  readonly counters = { gateStats: 0, dirScans: 0, headReads: 0 };

  constructor(
    private readonly root: string,
    readonly repo: TraceIndexRepo,
    /** Shared origin registry: registration-time classification publishes into it (single source of truth for `source`). */
    private readonly sources?: SessionSources,
  ) {}

  /**
   * Brings one Agent's index in step with disk. Hot path (nothing changed): two stat
   * calls, zero readdir. `force` ignores the mtime gate and diffs every date dir (the
   * consumers' miss-retry path).
   */
  reconcileAgent(
    projectId: string,
    agentId: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const key = `${projectId}\0${agentId}`;
    const existing = this.inflight.get(key);
    if (existing) {
      // A forced request must observe disk AFTER the point it was issued: chain a fresh
      // pass behind the in-flight one instead of piggybacking on possibly-gated work.
      return opts.force === true
        ? existing.then(() => this.reconcileAgent(projectId, agentId, opts))
        : existing;
    }
    const run = this.doReconcile(projectId, agentId, opts.force === true).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  /** Reconciles every Agent of a Project (the subagent-pointer resolver's miss path). */
  async reconcileProject(projectId: string, opts: { force?: boolean } = {}): Promise<void> {
    for (const agentId of await listDirs(agentsDir(this.root, projectId))) {
      await this.reconcileAgent(projectId, agentId, opts);
    }
  }

  private async doReconcile(projectId: string, agentId: string, force: boolean): Promise<void> {
    const key = `${projectId}\0${agentId}`;
    const dir = tracesDir(this.root, projectId, agentId);
    const cached = this.seen.get(key);
    this.counters.gateStats += 1;
    const rootMtime = await statMtime(dir);
    if (rootMtime === null) {
      // No traces directory: whatever the index still holds for this Agent is stale.
      this.repo.deleteByAgent(projectId, agentId);
      this.seen.set(key, { root: -1, dates: new Map() });
      return;
    }
    if (!force && cached && cached.root === rootMtime) {
      // Root unchanged (no date dir created/removed). The one blind spot on this level is
      // a new file inside an EXISTING date dir — in practice always the newest one (the
      // Writer names dirs by current local date) — so gate on that single dir's mtime too.
      // Cached sentinels (-1: the dir was fresh when last seen) never match, forcing a
      // re-diff until the tree has been quiet (see mtime-gate's FRESH_MS).
      const newest = [...cached.dates.keys()].sort().at(-1);
      if (newest === undefined) return;
      this.counters.gateStats += 1;
      const m = await statMtime(path.join(dir, newest));
      if (m !== null && m === cached.dates.get(newest)) return;
    }

    // Change detected / first look / force: diff date dirs (readdir only the changed ones).
    this.counters.dirScans += 1;
    const next: SeenDirs = { root: cacheable(rootMtime), dates: new Map() };
    const knownByDate = new Map<string, TraceFileRow[]>();
    for (const row of this.repo.listFilesByAgent(projectId, agentId)) {
      const list = knownByDate.get(row.date) ?? [];
      list.push(row);
      knownByDate.set(row.date, list);
    }
    const newSessions = new Set<string>();
    const dateDirs = await listDirs(dir);
    for (const date of dateDirs) {
      const m = await statMtime(path.join(dir, date));
      if (m === null) continue;
      next.dates.set(date, cacheable(m));
      // Unchanged dir already reflected in the gate cache: its rows are current. A fresh
      // mtime is never treated as unchanged (and was cached as a non-matching sentinel).
      if (!force && cached?.dates.get(date) === m) continue;
      const known = new Map(
        (knownByDate.get(date) ?? []).map((r) => [`${r.sessionId}\0${r.fileIndex}`, r]),
      );
      for (const file of await listFiles(path.join(dir, date))) {
        const match = TRACE_FILE_RE.exec(file);
        if (!match) continue;
        const sessionId = match[1]!;
        const fileIndex = Number(match[2]);
        const fileKey = `${sessionId}\0${fileIndex}`;
        let size = 0;
        try {
          size = (await fs.stat(path.join(dir, date, file))).size;
        } catch {
          continue; // Vanished between readdir and stat: skip; a later pass settles it.
        }
        this.repo.upsertFile({ projectId, agentId, sessionId, fileIndex, date, sizeBytes: size });
        known.delete(fileKey);
        if (this.repo.getSession(sessionId)?.metaRead !== true) newSessions.add(sessionId);
      }
      // Rows whose files vanished from this dir (external delete / rename).
      for (const row of known.values()) {
        this.repo.deleteFile(projectId, agentId, row.sessionId, row.fileIndex);
      }
    }
    // Whole date dirs deleted from disk.
    for (const [date, rows] of knownByDate) {
      if (next.dates.has(date)) continue;
      for (const row of rows)
        this.repo.deleteFile(projectId, agentId, row.sessionId, row.fileIndex);
    }
    // Registration-time classification: ONCE per newly seen Session (bounded head-read
    // of its earliest shard) — listings afterwards never touch file contents.
    for (const sessionId of newSessions) {
      await this.classifySession(projectId, agentId, sessionId);
    }
    this.seen.set(key, next);
  }

  /** Head-reads the Session's earliest indexed shard and stores its facts (origin/workspace/title/model ref). */
  private async classifySession(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const files = this.repo.listFilesBySession(projectId, agentId, sessionId);
    const earliest = files[0];
    if (earliest === undefined) return;
    this.counters.headReads += 1;
    let records: OmniMessage[];
    try {
      records = await readTraceHead(traceFilePath(this.root, earliest));
    } catch {
      records = []; // Unreadable head: facts stay unknown (meta_read=0 → retried by a later reconcile pass).
    }
    const facts = factsFromRecords(projectId, agentId, sessionId, records);
    this.repo.upsertSession(facts);
    if (facts.metaRead) this.sources?.set(sessionId, facts.source);
  }

  /**
   * Write-time registration for the Trace import route: the caller has the file's
   * identity AND parsed records in hand, so the row and facts are stored synchronously
   * with zero additional IO.
   */
  registerImportedFile(args: {
    projectId: string;
    agentId: string;
    sessionId: string;
    fileIndex: number;
    date: string;
    sizeBytes: number;
    records: OmniMessage[];
  }): void {
    this.repo.upsertFile({
      projectId: args.projectId,
      agentId: args.agentId,
      sessionId: args.sessionId,
      fileIndex: args.fileIndex,
      date: args.date,
      sizeBytes: args.sizeBytes,
    });
    const facts = factsFromRecords(args.projectId, args.agentId, args.sessionId, args.records);
    this.repo.upsertSession(facts);
    if (facts.metaRead) this.sources?.set(args.sessionId, facts.source);
    // The write moved the directory mtimes: drop the gate so the next reconcile re-syncs
    // (cheap — the import's own rows are already upserted; the pass just confirms).
    this.seen.delete(`${args.projectId}\0${args.agentId}`);
  }

  /** Write-time removal for Session deletion (files are being rm'ed by the caller). */
  removeSession(projectId: string, agentId: string, sessionId: string): void {
    this.repo.deleteBySession(sessionId);
    this.seen.delete(`${projectId}\0${agentId}`);
  }

  /** Agent deletion: its whole tree is going away with it. */
  removeAgent(projectId: string, agentId: string): void {
    this.repo.deleteByAgent(projectId, agentId);
    this.seen.delete(`${projectId}\0${agentId}`);
  }

  /** Project deletion. */
  removeProject(projectId: string): void {
    this.repo.deleteByProject(projectId);
    for (const key of this.seen.keys()) {
      if (key.startsWith(`${projectId}\0`)) this.seen.delete(key);
    }
  }
}
