/**
 * Telemetry's second batch of probes on a test App (PRFC-0008): a turn's server-side segments,
 * the session list, a generation's going recorded by its successor, the 内存 snapshot — and
 * none of it while the switch is off.
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
  /** Posts one Task and waits for the run to end; answers the request id its http.request carries. */
  const runTask = async () => {
    const res = await admin.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: INPUT }],
    });
    expect(res.status).toBeLessThan(300);
    await res.json();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    const posts = telemetryNode()
      .samples({ probe: "http.request" })
      .filter((s) => s.attrs?.method === "POST");
    return posts.at(-1)?.keys.request;
  };
  const telemetryNode = () => t.deps.tree.api<Telemetry>("TelemetryModule", "Telemetry");
  const one = (all: TelemetrySample[], probe: string) => {
    const found = all.filter((s) => s.probe === probe);
    expect(found, probe).toHaveLength(1);
    return found[0]!;
  };

  it("records a turn's server-side segments, tied by session, task and request, with no content", async () => {
    await turn(true);
    const request = await runTask();
    await waitFor(() => telemetryNode().samples({ probe: "turn.run" }).length === 1);
    const all = await samples();
    expect(one(all, "task.accept")).toMatchObject({
      keys: { session: SID, request },
      attrs: { queued: false },
    });
    expect(one(all, "session.load")).toMatchObject({
      attrs: { messages: 3 },
      status: "ok",
      keys: { session: SID, request },
    });
    const run = one(all, "turn.run");
    const task = run.keys.task;
    expect(task).toMatch(/^[0-9a-f-]{36}$/);
    expect(run).toMatchObject({
      status: "ok",
      keys: { session: SID, request },
      attrs: { messages: 4 },
    });
    expect(run.attrs!.modelMs as number).toBeGreaterThanOrEqual(MODEL_MS - 5);
    for (const segment of ["turn.tail", "turn.fanout", "turn.errors", "turn.usage"]) {
      expect(one(all, segment), segment).toMatchObject({
        attrs: { messages: 4 },
        keys: { session: SID, task, request },
      });
    }
    expect(all.filter((s) => s.probe === "turn.badge").length).toBeGreaterThanOrEqual(2);
    // The next Task finds the Session loaded (no session.load), under a task id of its own.
    await runTask();
    await waitFor(() => telemetryNode().samples({ probe: "turn.run" }).length === 2);
    expect(await samples("session.load")).toHaveLength(1);
    expect(new Set((await samples("turn.run")).map((s) => s.keys.task)).size).toBe(2);
    const dump = JSON.stringify(await samples());
    for (const content of [INPUT, ANSWER]) expect(dump).not.toContain(content);
  });

  it("records the session list's segments, and one reconcile per pass however many callers joined it", async () => {
    await turn(true);
    // The row was inserted behind the registry's back, so the list runs a hydration pass.
    expect((await admin.get(`/api/projects/${P}/agents/${A}/sessions`)).status).toBe(200);
    const all = await samples();
    const list = all.find(
      (s) => s.probe === "http.request" && String(s.attrs?.route).endsWith("/sessions"),
    );
    const inside = all.filter((s) => s.keys.request === list?.keys.request).map((s) => s.probe);
    expect(inside).toEqual(
      expect.arrayContaining(["sessions.list.sql", "sessions.list.reconcile", "trace.reconcile"]),
    );
    await admin.delete("/api/telemetry");
    await Promise.all([
      t.deps.traceIndex.reconcileAgent(P, A),
      t.deps.traceIndex.reconcileAgent(P, A),
    ]);
    expect(await samples("trace.reconcile")).toHaveLength(1);
  });

  it("records a generation's park and dispose in its successor, and where each generation came from", async () => {
    await turn(true);
    expect(await t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()).toBe(
      true,
    );
    const all = await samples();
    expect(one(all, "hmr.park").keys.generation).toBe(1);
    expect(one(all, "hmr.dispose").keys.generation).toBe(1);
    expect(one(all, "hmr.generation")).toMatchObject({
      keys: { generation: 2 },
      attrs: { cause: "reassemble" },
    });
  });

  it("records the process's and each loaded Session's 内存 when read — only while on", async () => {
    await runTask();
    expect(await read("?view=samples")).toMatchObject({ enabled: false, samples: [] });
    await turn(true);
    const all = await samples();
    expect(
      all.filter((s) => s.probe === "process.memory").at(-1)?.attrs?.memoryCost,
    ).toBeGreaterThan(0);
    const session = all.find((s) => s.probe === "session.memory" && s.keys.session === SID);
    expect(session?.attrs?.memoryCost).toBeGreaterThan(0);
  });
});
