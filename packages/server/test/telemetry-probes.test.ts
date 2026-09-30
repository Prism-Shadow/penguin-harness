/**
 * Telemetry's second batch of probes on a test App (PRFC-0008): the server-side segments of a
 * turn, tied by session, task and request; the session list's three segments and a reconcile
 * counted once on the call that led it; an App generation's going (park, dispose) recorded by
 * its successor, with where each generation came from; the machine view with each loaded
 * Session's own report — and none of it while the switch is off.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  ServerSettingsResponse,
  TelemetryResponse,
  TelemetrySample,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import type { Telemetry } from "../src/mechanisms/telemetry.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, loginAdmin, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const P = "default_project";
const A = "default_agent";
const SID = "session-2026-09-30-10-00-00-7e1e0002";
const INPUT = "a question nobody may read in a sample";
const ANSWER = "an answer nobody may read in a sample";
const MODEL_MS = 30;

/** A resumed Session that answers every Task with one model request and a closing line. */
function turnSession(sessionId: string): RuntimeSession {
  return {
    sessionId,
    resumedHistory: ["m1", "m2", "m3"],
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(): AsyncGenerator<OmniMessage> {
      yield requestBegin();
      await new Promise((r) => setTimeout(r, MODEL_MS));
      yield assistantText(ANSWER);
      yield requestEnd("completed");
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("telemetry probes", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp({ loader: { load: async (row) => turnSession(row.sessionId) } });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const now = new Date().toISOString();
    const row: SessionRow = {
      sessionId: SID,
      projectId: P,
      agentId: A,
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: now,
      lastActiveAt: now,
    };
    t.deps.sessionsRepo.insert(row);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const read = async (query = "") => {
    const res = await admin.get(`/api/telemetry${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as TelemetryResponse;
  };
  const samples = async (probe?: string) =>
    (await read(`?view=samples${probe !== undefined ? `&probe=${probe}` : ""}`)).samples ?? [];
  const turn = async (on: boolean) => {
    const res = await admin.put("/api/admin/settings", { telemetry: on });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ServerSettingsResponse).settings.telemetry).toBe(on);
  };
  /** Posts one Task and waits for the run to end; answers the request id the route sent back. */
  const runTask = async () => {
    const res = await admin.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: INPUT }],
    });
    expect(res.status).toBeLessThan(300);
    await res.json();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    return res.headers.get("x-penguin-request-id");
  };
  const telemetryNode = () => t.deps.tree.api<Telemetry>("TelemetryModule", "Telemetry");

  it("records a turn's server-side segments, tied by session, task and request", async () => {
    await turn(true);
    const request = await runTask();
    await waitFor(() => telemetryNode().samples({ probe: "turn.run" }).length === 1);

    const all = await samples();
    const one = (probe: string) => {
      const found = all.filter((s) => s.probe === probe);
      expect(found, probe).toHaveLength(1);
      return found[0]!;
    };
    const accept = one("task.accept");
    expect(accept.keys).toMatchObject({ session: SID, request });
    expect(accept.attrs).toMatchObject({ queued: false });
    expect(typeof accept.attrs?.lockMs).toBe("number");

    const ensure = one("session.ensure");
    expect(ensure).toMatchObject({ n: 3, status: "ok", keys: { session: SID, request } });
    expect(ensure.attrs).toMatchObject({ outcome: "load" });
    expect(typeof ensure.attrs?.loadMs).toBe("number");

    const run = one("turn.run");
    expect(run.keys).toMatchObject({ session: SID, request });
    const task = run.keys.task;
    expect(task).toMatch(/^[0-9a-f-]{36}$/);
    expect(run).toMatchObject({ n: 4, status: "ok" });
    expect(run.attrs).toMatchObject({ requests: 1 });
    expect(run.attrs!.modelMs as number).toBeGreaterThanOrEqual(MODEL_MS - 5);
    expect(run.attrs!.modelMs as number).toBeLessThanOrEqual(run.durMs!);
    for (const segment of ["turn.tail", "turn.fanout", "turn.errors", "turn.usage"]) {
      const s = one(segment);
      expect(s.n, segment).toBe(4);
      expect(s.keys, segment).toMatchObject({ session: SID, task, request });
    }
    const badges = all.filter((s) => s.probe === "turn.badge");
    expect(badges.map((s) => s.attrs?.state)).toEqual(expect.arrayContaining(["running", "idle"]));

    // The next Task finds the entry loaded, under a task id of its own.
    const again = await runTask();
    await waitFor(() => telemetryNode().samples({ probe: "turn.run" }).length === 2);
    const second = (await samples("session.ensure")).find((s) => s.keys.request === again)!;
    expect(second.attrs).toMatchObject({ outcome: "hit" });
    const tasks = new Set((await samples("turn.run")).map((s) => s.keys.task));
    expect(tasks.size).toBe(2);

    // Shape only: neither the input nor the answer made it into a sample.
    const dump = JSON.stringify(await samples());
    expect(dump).not.toContain(INPUT);
    expect(dump).not.toContain(ANSWER);
  });

  it("records the session list's three segments, and a reconcile once on the call that led it", async () => {
    await turn(true);
    // The row was inserted behind the registry's back, so the list runs a hydration pass.
    const res = await admin.get(`/api/projects/${P}/agents/${A}/sessions`);
    expect(res.status).toBe(200);
    await res.json();
    const request = res.headers.get("x-penguin-request-id");
    const listed = (await samples()).filter((s) => s.keys.request === request);
    const probes = listed.map((s) => s.probe);
    expect(probes).toEqual(
      expect.arrayContaining([
        "sessions.list.sql",
        "sessions.list.reconcile",
        "sessions.list.rows",
        "trace.reconcile",
      ]),
    );
    expect(listed.find((s) => s.probe === "sessions.list.sql")!.n).toBeGreaterThanOrEqual(1);
    expect(listed.find((s) => s.probe === "trace.reconcile")!.status).toBe("led");

    // Two callers at once: one pass, counted on the first; the second shares it.
    await admin.delete("/api/telemetry");
    await Promise.all([
      t.deps.traceIndex.reconcileAgent(P, A),
      t.deps.traceIndex.reconcileAgent(P, A),
    ]);
    expect((await samples("trace.reconcile")).map((s) => s.status)).toEqual(["led", "shared"]);
  });

  it("records a generation's park and dispose in its successor, and where each generation came from", async () => {
    await turn(true);
    expect(await t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()).toBe(
      true,
    );
    const all = await samples();
    const park = all.find((s) => s.probe === "hmr.park");
    const dispose = all.find((s) => s.probe === "hmr.dispose");
    expect(park?.keys.generation).toBe(1);
    expect(dispose?.keys.generation).toBe(1);
    expect(dispose!.durMs).toBeGreaterThanOrEqual(0);
    const generation = all.find((s) => s.probe === "hmr.generation") as TelemetrySample;
    expect(generation).toMatchObject({ n: 2, keys: { generation: 2 } });
    // The same bundle created twice in this process: what a repeated push looks like.
    expect(generation.attrs).toMatchObject({ cause: "reassemble", creates: 2, repeat: true });
    expect(generation.attrs?.bundle).toMatch(/^[0-9a-f]{12}$/);
    expect(all.find((s) => s.probe === "process.memory")!.bytes).toBeGreaterThan(0);
  });

  it("serves the machine view: the process, its generations, and each loaded session's report", async () => {
    await turn(true);
    await runTask();
    const { machine } = await read("?view=machine");
    expect(machine).toBeDefined();
    expect(machine!.process.rss).toBeGreaterThan(0);
    expect(machine!.process.heapUsed).toBeGreaterThan(0);
    expect(machine!.generation.current).toBe(1);
    expect(machine!.generation.bundles).toHaveLength(1);
    expect(machine!.generation.bundles[0]!.creates).toBe(1);
    const report = machine!.sessions?.find((s) => s.session === SID);
    expect(report).toMatchObject({
      status: "idle",
      resumedHistory: 3,
      liveFragments: 0,
      liveBytes: 0,
      followUps: 0,
    });
    expect(report!.channelEvents).toBeGreaterThan(0);
    expect(report!.channelBytes).toBeGreaterThan(0);
    expect(report!.subscribers).toBe(0);
    expect(machine!.totals).toMatchObject({ sessions: 1, resumedHistory: 3 });
  });

  it("while off: no sample from a turn or a list, and the machine view asks the Sessions nothing", async () => {
    await runTask();
    await admin.get(`/api/projects/${P}/agents/${A}/sessions`);
    expect(await read("?view=samples")).toMatchObject({ enabled: false, samples: [] });

    let asked = 0;
    telemetryNode().addReport("sessions", () => {
      asked += 1;
      return [];
    });
    const off = await read("?view=machine");
    expect(off).toMatchObject({ enabled: false });
    expect(off.machine).toBeUndefined();
    expect(asked).toBe(0);
  });
});
