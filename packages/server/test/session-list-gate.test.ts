/**
 * The sidebar list's Trace-discovery gate.
 *
 * Every row discovery asks one question: has this Session written Trace files the index has
 * not stamped yet? It used to be answered by a reconciled walk of the Agent's whole trace
 * tree, on the request path, for every Session created before the process started — i.e. for
 * the whole sidebar, on every list request. The gate now answers it from one read-only sweep
 * of the date directories, and remembers the Sessions that have nothing on disk, so a later
 * request probes neither of them again.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tracesDir } from "@prismshadow/penguin-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { SessionService, type SessionServiceDeps } from "../src/services/session-service.js";

const PROJECT = "default_project";
const AGENT = "default_agent";
const WITH_TRACE = "session-2026-10-13-10-00-00-aaaaaaaa";
const WITHOUT_TRACE = "session-2026-10-13-10-00-01-bbbbbbbb";

function row(sessionId: string): SessionRow {
  return { sessionId, projectId: PROJECT, agentId: AGENT, hasTrace: false } as SessionRow;
}

interface Walked {
  rows: Map<string, SessionRow>;
  traces?: ReadonlySet<string>;
}

async function fixture(root: string, rows: SessionRow[]) {
  const markHasTrace = vi.fn();
  const reconcileAgent = vi.fn(async () => {});
  const service = new SessionService({
    root,
    sessions: { listByAgent: () => rows, markHasTrace },
    traceIndex: { reconcileAgent },
  } as unknown as SessionServiceDeps);
  const walk = () =>
    (
      service as unknown as {
        walkRows: (projectId: string, agentId: string, excludeOrg: boolean) => Promise<Walked>;
      }
    ).walkRows(PROJECT, AGENT, false);
  return { walk, markHasTrace, reconcileAgent, service };
}

describe("the sidebar list's Trace-discovery gate", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("answers from one read-only sweep, then stops probing Sessions with nothing on disk", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-list-gate-"));
    roots.push(root);
    const dir = tracesDir(root, PROJECT, AGENT);
    await fs.mkdir(path.join(dir, "2026-10-13"), { recursive: true });
    await fs.writeFile(path.join(dir, "2026-10-13", `${WITH_TRACE}_001.jsonl`), "{}\n");

    const { walk, markHasTrace, reconcileAgent, service } = await fixture(root, [
      row(WITH_TRACE),
      row(WITHOUT_TRACE),
    ]);

    const readdir = vi.spyOn(fs, "readdir");
    /** Only the reads of THIS Agent's trace tree count — the runtime reads other directories. */
    const probes = (): number =>
      readdir.mock.calls.filter(([target]) => typeof target === "string" && target.startsWith(dir))
        .length;
    const first = await walk();
    const sweeps = probes();
    expect(sweeps).toBeGreaterThan(0);

    // The Session whose shard is on disk is stamped — once, by the write-time path.
    expect(first.rows.get(WITH_TRACE)?.hasTrace).toBe(true);
    expect(markHasTrace).toHaveBeenCalledTimes(1);
    expect(markHasTrace).toHaveBeenCalledWith(WITH_TRACE);
    // The one with nothing on disk stays unstamped and is remembered instead.
    expect(first.rows.get(WITHOUT_TRACE)?.hasTrace).toBe(false);
    // Discovery hands the found Session to the authoritative reconcile, which classifies it.
    expect(reconcileAgent).toHaveBeenCalledTimes(1);

    const second = await walk();
    // The second request touches no directory at all: nothing left to discover.
    expect(probes()).toBe(sweeps);
    expect(reconcileAgent).toHaveBeenCalledTimes(1);
    expect(markHasTrace).toHaveBeenCalledTimes(1);
    expect(second.rows.get(WITHOUT_TRACE)?.hasTrace).toBe(false);
  });

  it("answers an Agent whose trace tree does not exist yet without failing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-list-gate-"));
    roots.push(root);
    const { walk, markHasTrace, reconcileAgent } = await fixture(root, [row(WITHOUT_TRACE)]);

    const walked = await walk();
    expect(walked.rows.get(WITHOUT_TRACE)?.hasTrace).toBe(false);
    expect(reconcileAgent).not.toHaveBeenCalled();
    expect(markHasTrace).not.toHaveBeenCalled();
  });
});
