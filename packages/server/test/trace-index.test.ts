/**
 * Trace-file index tests: mtime-gated reconciliation (an unchanged tree costs zero
 * directory scans), registration-time classification, gate blind spots recovered by
 * the consumers' force-retry, write-time registration (import) and delete coherence.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionMetaPayload } from "@prismshadow/penguin-core";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-i";
const A = "agent-i";
const S1 = "session-2026-07-05-10-00-00-aabb0001";
const S2 = "session-2026-07-06-09-00-00-aabb0002";
const OLD = "session-2026-07-01-08-00-00-aabb0003";

/**
 * Ages the given paths' mtimes past the reconciler's FRESH_MS window: freshly written
 * dirs are deliberately never cached as clean (same-tick change hazard), so steady-state
 * assertions first make the tree look quiet, exactly like a tree written minutes ago.
 */
async function backdate(...paths: string[]): Promise<void> {
  // A FIXED past instant, so repeated backdates are idempotent: the blind-spot test
  // resets a changed dir to exactly the mtime the gate cached, which is precisely the
  // "old dir changed without moving any gated mtime" scenario.
  const old = new Date("2026-01-01T00:00:00.000Z");
  for (const p of paths) {
    await fs.utimes(p, old, old);
  }
}

function tracesRoot(root: string): string {
  return path.join(root, P, "agents", A, "traces");
}

function meta(sessionId: string, over: Partial<SessionMetaPayload> = {}): SessionMetaPayload {
  return {
    session_id: sessionId,
    model_id: "m1",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/ws/one",
    ...over,
  };
}

describe("trace-index", () => {
  let root: string;
  let h: ReturnType<typeof makeTraceHarness>;

  beforeEach(async () => {
    root = await makeTempRoot();
    h = makeTraceHarness(root);
  });
  afterEach(async () => {
    h.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("registers external files on reconcile and classifies each Session once; an unchanged tree costs zero directory scans", async () => {
    await writeTraceFile(root, P, A, "2026-07-05", S1, 1, [
      sessionMeta(meta(S1, { source: "subagent" })),
      userText("你好，请检查代码"),
    ]);
    await backdate(tracesRoot(root), path.join(tracesRoot(root), "2026-07-05"));
    await h.traceIndex.reconcileAgent(P, A);
    const rows = h.traceIndex.repo.listFilesByAgent(P, A);
    expect(
      rows.map((r) => ({ sessionId: r.sessionId, fileIndex: r.fileIndex, date: r.date })),
    ).toEqual([{ sessionId: S1, fileIndex: 1, date: "2026-07-05" }]);
    expect(rows[0]!.sizeBytes).toBeGreaterThan(0);
    // Registration-time facts: origin / workspace / first-prompt title, one head-read.
    const facts = h.traceIndex.repo.getSession(S1);
    expect(facts?.source).toBe("subagent");
    expect(facts?.workspace).toBe("/ws/one");
    expect(facts?.title).toBe("你好，请检查代码");
    expect(facts?.metaRead).toBe(true);
    expect(h.sources.get(S1)).toBe("subagent");
    expect(h.traceIndex.counters.headReads).toBe(1);

    // Steady state: reconciling an unchanged tree is pure gate stats — no readdir, no reads.
    const scans = h.traceIndex.counters.dirScans;
    await h.traceIndex.reconcileAgent(P, A);
    await h.traceIndex.reconcileAgent(P, A);
    expect(h.traceIndex.counters.dirScans).toBe(scans);
    expect(h.traceIndex.counters.headReads).toBe(1);

    // A new shard in the same (newest) date dir moves that dir's mtime: the gate notices.
    await writeTraceFile(root, P, A, "2026-07-05", S2, 1, [
      sessionMeta(meta(S2)),
      userText("second session"),
    ]);
    await h.traceIndex.reconcileAgent(P, A);
    expect(h.traceIndex.repo.listFilesByAgent(P, A)).toHaveLength(2);
    expect(h.traceIndex.counters.dirScans).toBe(scans + 1);
    expect(h.traceIndex.repo.getSession(S2)?.metaRead).toBe(true);
  });

  it("a write into an OLD date dir slips past the gate; the consumers' force-retry (locateAll) recovers it", async () => {
    // Two date dirs indexed; the gate then watches the root + the NEWEST dir only.
    await writeTraceFile(root, P, A, "2026-07-01", OLD, 1, [userText("old day")]);
    await writeTraceFile(root, P, A, "2026-07-05", S1, 1, [userText("new day")]);
    await backdate(
      tracesRoot(root),
      path.join(tracesRoot(root), "2026-07-01"),
      path.join(tracesRoot(root), "2026-07-05"),
    );
    await h.traceIndex.reconcileAgent(P, A);
    expect(h.traceIndex.repo.listFilesByAgent(P, A)).toHaveLength(2);

    // External writer appends a SECOND shard into the old dir: neither gated mtime
    // (root / newest dir) moves. Backdating the old dir again keeps its change invisible
    // even to a freshness-triggered re-diff — the pure gate blind spot.
    await writeTraceFile(root, P, A, "2026-07-01", OLD, 2, [userText("late arrival")]);
    await backdate(tracesRoot(root), path.join(tracesRoot(root), "2026-07-01"));
    await h.traceIndex.reconcileAgent(P, A);
    expect(h.traceIndex.repo.listFilesBySession(P, A, OLD)).toHaveLength(1); // gate blind spot

    // A consumer that misses must force-reconcile and retry rather than 404: the
    // service's listTraceFiles goes through locateAll, which does exactly that when the
    // requested index is absent... locateAll's whole-session miss is the trigger, so
    // exercise it via a session the index does not know at all.
    const LATE = "session-2026-07-01-09-00-00-aabb0009";
    await writeTraceFile(root, P, A, "2026-07-01", LATE, 1, [userText("unseen session")]);
    await backdate(tracesRoot(root), path.join(tracesRoot(root), "2026-07-01"));
    const files = await h.service.listTraceFiles(P, A, LATE);
    expect(files.map((f) => f.index)).toEqual([1]);
    // The forced pass also swept in the other blind-spot shard.
    expect(h.traceIndex.repo.listFilesBySession(P, A, OLD)).toHaveLength(2);
  });

  it("import registers synchronously (rows + facts, no re-read); Session delete removes files and rows", async () => {
    const IMP = "session-2026-07-03-12-00-00-aabb0004";
    const lines = [
      sessionMeta(meta(IMP, { source: "schedule", workspace: "/ws/imp" })),
      userText("imported prompt"),
    ]
      .map((m) => JSON.stringify({ ...m, timestamp: "2026-07-03T12:00:00.000Z" }))
      .join("\n");
    const headReads = h.traceIndex.counters.headReads;
    const res = await h.service.importTraceFile(P, A, lines);
    expect(res).toEqual({ sessionId: IMP, index: 1, date: "2026-07-03" });
    // Registered without any head-read (the records were already in memory).
    expect(h.traceIndex.counters.headReads).toBe(headReads);
    expect(h.traceIndex.repo.listFilesBySession(P, A, IMP)).toHaveLength(1);
    const facts = h.traceIndex.repo.getSession(IMP);
    expect(facts?.source).toBe("schedule");
    expect(facts?.workspace).toBe("/ws/imp");
    expect(facts?.title).toBe("imported prompt");

    await h.service.deleteSessionTraces(P, A, IMP);
    expect(h.traceIndex.repo.listFilesBySession(P, A, IMP)).toEqual([]);
    expect(h.traceIndex.repo.getSession(IMP)).toBeNull();
    // The files are gone from disk too, and a fresh reconcile does not resurrect rows.
    await h.traceIndex.reconcileAgent(P, A, { force: true });
    expect(h.traceIndex.repo.listFilesBySession(P, A, IMP)).toEqual([]);
  });

  it("externally deleted files and date dirs fall out of the index on the next changed-dir pass", async () => {
    await writeTraceFile(root, P, A, "2026-07-05", S1, 1, [userText("a")]);
    await writeTraceFile(root, P, A, "2026-07-05", S1, 2, [userText("b")]);
    await h.traceIndex.reconcileAgent(P, A);
    expect(h.traceIndex.repo.listFilesBySession(P, A, S1)).toHaveLength(2);

    const dir = path.join(root, P, "agents", A, "traces", "2026-07-05");
    await fs.rm(path.join(dir, `${S1}_002.jsonl`));
    await h.traceIndex.reconcileAgent(P, A); // the dir's mtime moved: rescanned
    expect(h.traceIndex.repo.listFilesBySession(P, A, S1).map((r) => r.fileIndex)).toEqual([1]);

    await fs.rm(dir, { recursive: true });
    await h.traceIndex.reconcileAgent(P, A); // the root's mtime moved: date dir purged
    expect(h.traceIndex.repo.listFilesByAgent(P, A)).toEqual([]);
  });
});
