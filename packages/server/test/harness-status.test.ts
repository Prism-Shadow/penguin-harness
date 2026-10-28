/**
 * The harness status bar's one poll, POST /api/harness-status:
 *
 * - A non-admin is refused with 403 `admin_required` — the counts and the list span every
 *   Project and every user's Sessions, so the surface is the admin's alone.
 * - An empty harness answers zero counts, an empty list, an empty `machines`, and the system
 *   shape (memory is a real pair; CPU is null until a second reading exists).
 * - Every row counts whichever Project or client owns it — the request names the ids it
 *   opened, and the answer carries those rows, newest first, TOGETHER with every active
 *   Session, opened or not (an idle one nobody opened is the opened set's business alone);
 *   malformed ids are dropped rather than refused, and more than 200 is a 400.
 * - The fan-out: each connected machine is asked through its own client with `own` set, its
 *   running count is summed in, its rows ride the answer stamped with the machine that
 *   answered, and its load lands in `machines`. A machine that answers 404 (a build from
 *   before this route) or garbage contributes nothing; an `own` request of our own asks no
 *   machine at all.
 * - Each row names the organization that holds it (`orgId`): this server's rows read its own
 *   caches — a desk's Session, a ticket's, or null when no organization holds it — and a
 *   machine's rows say whatever that machine said for them, a wrong-typed id costing the row
 *   its company, never its place in the list.
 * - The system sampler's pure half: a utilization delta is a ratio of the two readings
 *   (all-idle 0, all-busy 100, mixed exact, an idle core's zero window is fine), a zero or
 *   backwards delta is null rather than a divide-by-zero, mismatched shapes are null; the
 *   service diffs consecutive readings and serves its cache within the spacing window.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import type { HarnessStatusResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import {
  MIN_SAMPLE_SPACING_MS,
  SystemStatusService,
  computeCpuPercent,
  readMemory,
} from "../src/services/system-status.js";
import type { CpuTimes } from "../src/services/system-status.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeMachinesNode } from "./fixtures/machines.js";
import type { FleetMachineDouble } from "./fixtures/machines.js";

describe("harness status bar (POST /api/harness-status)", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  /** The machines the poll fans out to, swapped per case; empty means this server alone. */
  let fleet: FleetMachineDouble[] = [];

  beforeAll(async () => {
    t = await createTestApp({
      machines: fakeMachinesNode(
        () => [],
        undefined,
        () => fleet,
      ),
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "alice")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    fleet = [];
  });

  /** A row as the index stores one, with the fields the bar's list reads. */
  const row = (n: number, over: Partial<SessionRow> = {}): SessionRow => ({
    sessionId: `sess-${String(n).padStart(3, "0")}`,
    projectId: over.projectId ?? "p1",
    agentId: "general",
    provider: "custom",
    modelId: "kimi-k3",
    workspace: `/tmp/ws-${n}`,
    approvalMode: "allow-all",
    title: null,
    // Fixed-width minute:second fields, so lexicographic order (what the TEXT column's
    // ORDER BY is) and numeric order agree: row 150 is the newest of the 150.
    lastActiveAt: `2026-10-22T00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`,
    createdAt: `2026-10-22T00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`,
    ...over,
  });

  it("refuses a non-admin with 403 admin_required", async () => {
    const res = await member.post("/api/harness-status", { open: [] });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("admin_required");
  });

  it("answers zero counts and the system shape on an empty harness", async () => {
    const res = await admin.post("/api/harness-status", { open: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    expect(body.running).toBe(0);
    expect(body.sessions).toEqual([]);
    expect(body.machines).toEqual([]);
    // Memory is a live pair of the machine running the test; CPU is null on the first
    // reading of the process (no previous reading to take a delta against).
    expect(body.system.memoryTotalBytes).toBeGreaterThan(0);
    expect(body.system.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    expect(body.system.memoryUsedBytes).toBeLessThanOrEqual(body.system.memoryTotalBytes);
    expect(body.system.cpuPercent).toBeNull();
  });

  it("counts every row, answers exactly the opened rows, and never answers a total", async () => {
    // 150 rows across two Projects and three clients, stamped in reverse so row numbers
    // and recency agree; row 150 is the newest.
    for (let n = 150; n >= 1; n--) {
      t.deps.sessionsRepo.insert(
        row(n, {
          projectId: n <= 50 ? "p1" : "p2",
          client: n % 3 === 0 ? "org" : n % 3 === 1 ? "web" : null,
          ...(n === 150 ? { title: "the newest one" } : {}),
        }),
      );
    }
    const res = await admin.post("/api/harness-status", {
      open: ["sess-002", "sess-147", "sess-150"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    // No runtime entry exists for any row, so nothing is running and every row reads idle —
    // the count still spans every row the harness holds, not only the opened ones.
    expect(body.running).toBe(0);
    expect(body.sessions.map((s) => s.sessionId)).toEqual(["sess-150", "sess-147", "sess-002"]);
    const [first] = body.sessions;
    expect(first?.title).toBe("the newest one");
    expect(first?.status).toBe("idle");
    expect(first?.machineId).toBeNull();
    // The row's own fields ride along, whichever Project or client owns it.
    expect(first?.projectId).toBe("p2");
    const orgRow = body.sessions.find((s) => s.sessionId === "sess-147");
    expect(orgRow?.client).toBe("org");
    // The old whole-table total is gone: the second count is the caller's own business.
    expect(body).not.toHaveProperty("total");
  });

  it("stamps each row with the organization that holds it", async () => {
    // The caches a reconcile pass would have projected, seeded by hand: one organization's
    // desk Session, another's ticket Session — and sess-150, which no organization holds.
    // The poll names all three: each row carries the company a click can be taken to, or
    // null when there is none — the reach is a fact of the row, not of the click.
    t.deps.orgCacheRepo.syncDeskSessions("p1", "acme", [
      { sessionId: "sess-002", agentId: "agent-acme", current: true },
    ]);
    t.deps.orgCacheRepo.addTicketSession("p2", "globex", "t-1", "sess-147", "agent-globex");
    const res = await admin.post("/api/harness-status", {
      open: ["sess-002", "sess-147", "sess-150"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    expect(body.sessions.find((s) => s.sessionId === "sess-002")?.orgId).toBe("acme");
    expect(body.sessions.find((s) => s.sessionId === "sess-147")?.orgId).toBe("globex");
    expect(body.sessions.find((s) => s.sessionId === "sess-150")?.orgId).toBeNull();
  });

  it("answers an active row nobody opened, and never an idle one nobody opened", async () => {
    // Two rows the request never named are made running, the rest of the harness stays idle.
    // The list's active half is the harness's own truth, so the running ones ride the answer
    // opened or not; an idle one nobody opened is the opened set's business alone, and the
    // count and the list follow the same rule — they cannot disagree.
    const statusOf = vi
      .spyOn(t.deps.manager, "statusOf")
      .mockImplementation((id: string) =>
        id === "sess-120" || id === "sess-119" ? "running" : "idle",
      );
    try {
      const res = await admin.post("/api/harness-status", { open: ["sess-150"] });
      expect(res.status).toBe(200);
      const body = (await res.json()) as HarnessStatusResponse;
      expect(body.running).toBe(2);
      // Newest first: the opened row (150) ahead of the two active strangers (120, 119).
      expect(body.sessions.map((s) => s.sessionId)).toEqual(["sess-150", "sess-120", "sess-119"]);
      expect(body.sessions.find((s) => s.sessionId === "sess-120")?.status).toBe("running");
    } finally {
      statusOf.mockRestore();
    }
  });

  it("drops malformed ids and refuses more than 200", async () => {
    const dropped = await admin.post("/api/harness-status", {
      open: [42, true, "", "sess-150", "a-b_C9"],
    });
    expect(dropped.status).toBe(200);
    const body = (await dropped.json()) as HarnessStatusResponse;
    // The malformed ids are gone; "a-b_C9" is a well-formed id this harness holds no row
    // for, so it simply has nothing to answer with.
    expect(body.sessions.map((s) => s.sessionId)).toEqual(["sess-150"]);

    const ids = Array.from({ length: 201 }, (_, i) => `sess-${String(i).padStart(3, "0")}`);
    const refused = await admin.post("/api/harness-status", { open: ids });
    expect(refused.status).toBe(400);
    const error = (await refused.json()) as { error: { code: string } };
    expect(error.error.code).toBe("bad_request");
  });

  /** A machine's share as a stub client would hand it: fixed numbers, its row naming the
   * organization that machine holds it for. */
  const remoteShare = (over: Partial<Record<string, unknown>> = {}) => ({
    running: 2,
    sessions: [
      {
        sessionId: "sess-remote-001",
        projectId: "pm",
        agentId: "general",
        title: "the far side",
        workspace: "/remote/ws",
        client: "org",
        status: "running",
        lastActiveAt: "2026-10-22T01:00:00.000Z",
        machineId: null,
        orgId: "acme",
      },
    ],
    system: { cpuPercent: 11.1, memoryUsedBytes: 1_000, memoryTotalBytes: 2_000 },
    machines: [],
    ...over,
  });

  it("sums a machine's share in, stamps its rows and carries its load", async () => {
    const asked: Array<{ method: string; path: string; body: unknown; timeoutMs?: number }> = [];
    fleet = [
      {
        machineId: "m-remote",
        alias: "remote-box",
        api: {
          request: async (method, path, body, timeoutMs) => {
            asked.push({ method, path, body, timeoutMs });
            return { status: 200, text: JSON.stringify(remoteShare()) };
          },
        },
      },
    ];
    const res = await admin.post("/api/harness-status", {
      open: ["sess-150", "sess-remote-001"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    // This server's 0 plus the machine's 2.
    expect(body.running).toBe(2);
    // Both rows, the machine's stamped with the machine that answered.
    expect(body.sessions).toHaveLength(2);
    const remote = body.sessions.find((s) => s.sessionId === "sess-remote-001");
    expect(remote?.machineId).toBe("m-remote");
    expect(remote?.status).toBe("running");
    // The organization the machine named for its own row rides the answer whole, exactly as
    // the machine answered it — each machine speaks for the Sessions it holds.
    expect(remote?.orgId).toBe("acme");
    const local = body.sessions.find((s) => s.sessionId === "sess-150");
    expect(local?.machineId).toBeNull();
    // The machine's own load rides the answer under its own id and alias.
    expect(body.machines).toEqual([
      {
        machineId: "m-remote",
        alias: "remote-box",
        system: { cpuPercent: 11.1, memoryUsedBytes: 1_000, memoryTotalBytes: 2_000 },
      },
    ]);
    // The fan-out asked the machine's own copy of the route, with `own` set so a machine
    // that lists this server back never makes the poll recurse.
    expect(asked).toEqual([
      {
        method: "POST",
        path: "/api/harness-status",
        body: { open: ["sess-150", "sess-remote-001"], own: true },
        timeoutMs: 4_000,
      },
    ]);
  });

  it("a machine's wrong-typed orgId reads null, keeping its row in the list", async () => {
    fleet = [
      {
        machineId: "m-typed",
        alias: "typed-box",
        api: {
          request: async () => ({
            status: 200,
            text: JSON.stringify(
              remoteShare({
                sessions: [
                  {
                    sessionId: "sess-remote-002",
                    projectId: "pm",
                    agentId: "general",
                    title: "the far side",
                    workspace: "/remote/ws",
                    client: "org",
                    status: "running",
                    lastActiveAt: "2026-10-22T01:00:00.000Z",
                    machineId: null,
                    orgId: 42, // a machine that types it wrong: the row stays, the company goes
                  },
                ],
              }),
            ),
          }),
        },
      },
    ];
    const res = await admin.post("/api/harness-status", { open: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    const remote = body.sessions.find((s) => s.sessionId === "sess-remote-002");
    // The wrong type costs the click its company, not the row its place in the list.
    expect(remote?.orgId).toBeNull();
    expect(remote?.machineId).toBe("m-typed");
  });

  it("a machine answering 404 or garbage contributes nothing", async () => {
    fleet = [
      {
        machineId: "m-old",
        alias: "old-box",
        api: { request: async () => ({ status: 404, text: "no such route" }) },
      },
      {
        machineId: "m-odd",
        alias: "odd-box",
        api: { request: async () => ({ status: 200, text: "<html>not json</html>" }) },
      },
      {
        machineId: "m-shape",
        alias: "shape-box",
        api: {
          request: async () => ({ status: 200, text: JSON.stringify({ total: 5 }) }),
        },
      },
      {
        machineId: "m-null",
        alias: "null-box",
        api: {
          request: async () => ({
            status: 200,
            text: JSON.stringify(remoteShare({ running: "x" })),
          }),
        },
      },
    ];
    const res = await admin.post("/api/harness-status", { open: ["sess-remote-001"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    expect(body.running).toBe(0);
    expect(body.machines).toEqual([]);
    expect(body.sessions).toEqual([]);
  });

  it("an own request answers this server alone, asking no machine", async () => {
    let asked = 0;
    fleet = [
      {
        machineId: "m-counted",
        alias: "counted-box",
        api: {
          request: async () => {
            asked += 1;
            return { status: 200, text: JSON.stringify(remoteShare()) };
          },
        },
      },
    ];
    // A browser's poll fans out once…
    await admin.post("/api/harness-status", { open: [] });
    expect(asked).toBe(1);
    // …and the poll this server answers on another's behalf asks nobody.
    const res = await admin.post("/api/harness-status", { open: [], own: true });
    expect(res.status).toBe(200);
    expect(asked).toBe(1);
    const body = (await res.json()) as HarnessStatusResponse;
    expect(body.machines).toEqual([]); // this server's share is the whole answer
  });
});

describe("system status sampler (services/system-status.ts)", () => {
  /** One core's counters. */
  const core = (over: Partial<CpuTimes> = {}): CpuTimes => ({
    user: 100,
    nice: 0,
    sys: 100,
    idle: 100,
    irq: 0,
    ...over,
  });

  it("a utilization delta is a ratio of the two readings", () => {
    // All idle: 0. All busy: 100. Half busy: 50, one decimal. Two cores, one busy all
    // window and one idle all window: half the machine, and the idle core's zero-busy
    // window is a reading, not an error.
    expect(computeCpuPercent([core()], [core({ idle: 200 })])).toBe(0);
    expect(computeCpuPercent([core()], [core({ user: 200, idle: 100 })])).toBe(100);
    expect(computeCpuPercent([core()], [core({ user: 150, idle: 150 })])).toBe(50);
    expect(computeCpuPercent([core(), core()], [core({ user: 300 }), core({ idle: 300 })])).toBe(
      50,
    );
  });

  it("a zero, backwards or mismatched delta is null, never NaN", () => {
    expect(computeCpuPercent([core()], [core()])).toBeNull();
    expect(computeCpuPercent([core({ idle: 200 })], [core({ idle: 100 })])).toBeNull();
    expect(computeCpuPercent([], [])).toBeNull();
    expect(computeCpuPercent([core()], [core(), core()])).toBeNull();
  });

  it("readMemory answers the machine's live pair", () => {
    const mem = readMemory();
    expect(mem.memoryTotalBytes).toBeGreaterThan(0);
    expect(mem.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    expect(mem.memoryUsedBytes).toBeLessThanOrEqual(mem.memoryTotalBytes);
  });

  it("the service diffs consecutive readings and serves its cache inside the spacing window", () => {
    const GB = 1024 ** 3;
    const service = new SystemStatusService();
    // Controlled readings and memory, so every number is the test's own: the first read has
    // no predecessor to diff against, the second is half-busy since the first, and the third
    // never reads the counters at all.
    const reading = (user: number, idle: number): os.CpuInfo => ({
      model: "",
      speed: 0,
      times: { user, nice: 0, sys: 100, idle, irq: 0 },
    });
    const cpus = vi
      .spyOn(os, "cpus")
      .mockReturnValueOnce([reading(100, 100)])
      .mockReturnValueOnce([reading(200, 200)]);
    const totalmem = vi.spyOn(os, "totalmem").mockReturnValue(16 * GB);
    const freemem = vi.spyOn(os, "freemem").mockReturnValue(4 * GB);
    try {
      const first = service.read();
      expect(first.cpuPercent).toBeNull(); // nothing to diff against yet
      expect(first.memoryUsedBytes).toBe(12 * GB);
      expect(first.memoryTotalBytes).toBe(16 * GB);
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + MIN_SAMPLE_SPACING_MS + 1);
      try {
        const second = service.read();
        expect(second.cpuPercent).toBe(50); // 100 busy of the 200 ticks since the first
        now.mockRestore();
        const third = service.read(); // back on the real clock: still inside the window
        expect(third).toBe(second); // the cached answer — the very object, reference and all
      } finally {
        now.mockRestore();
      }
    } finally {
      cpus.mockRestore();
      totalmem.mockRestore();
      freemem.mockRestore();
    }
  });
});
