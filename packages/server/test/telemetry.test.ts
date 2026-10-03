/**
 * Telemetry end to end on a test App (PRFC-0008, first slice): the switch in the system
 * settings, the three fixed probes — http.request on the platform surface, the boot of an
 * App generation, and a session open (session.messages + trace.read) — the admin read route
 * and its views, and what must NOT happen: nothing recorded while off, no content in a sample,
 * no read for a non-admin.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  requestBegin,
  requestEnd,
  sessionMeta,
  userText,
} from "@prismshadow/penguin-core";
import type {
  ServerSettingsResponse,
  TelemetryResponse,
  TelemetrySample,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const P = "default_project";
const A = "default_agent";
const SID = "session-2026-09-30-08-00-00-7e1e0001";
const SECRET_TEXT = "the answer nobody may read in a sample";
const KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";

describe("telemetry", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
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
    await writeTraceFile(t.root, P, A, "2026-09-30", SID, 1, [
      sessionMeta({
        session_id: SID,
        provider: "custom",
        model_id: "m1",
        system_prompt: "",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
      } as never),
      userText(`export OPENAI_API_KEY=${KEY}`),
      requestBegin(),
      assistantText(SECRET_TEXT),
      requestEnd("completed"),
    ]);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const read = async (query = "") => {
    const res = await admin.get(`/api/telemetry${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as TelemetryResponse;
  };
  const turn = async (on: boolean) => {
    const res = await admin.put("/api/admin/settings", { telemetry: on });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ServerSettingsResponse).settings.telemetry).toBe(on);
  };
  const openSession = async () => {
    const res = await admin.get(`/api/sessions/${SID}/messages?tailLimit=10`);
    expect(res.status).toBe(200);
    await res.json();
    return res;
  };

  it("is off by default: nothing is recorded, no request id is minted", async () => {
    const settings = (await (
      await admin.get("/api/admin/settings")
    ).json()) as ServerSettingsResponse;
    expect(settings.settings.telemetry).toBe(false);
    const res = await openSession();
    expect(res.headers.get("x-penguin-request-id")).toBeNull();
    const body = await read("?view=samples");
    expect(body).toMatchObject({ enabled: false, buffered: 0, samples: [] });
  });

  it("records a request, the session open and its shard reads, tied by one request id", async () => {
    await turn(true);
    const res = await openSession();
    const request = res.headers.get("x-penguin-request-id");
    expect(request).toMatch(/^[0-9a-f-]{36}$/);

    const { samples = [] } = await read("?view=samples");
    const http = samples.find(
      (s) => s.probe === "http.request" && s.keys.request === request,
    ) as TelemetrySample;
    expect(http).toBeDefined();
    expect(http.attrs).toMatchObject({
      method: "GET",
      route: "/api/sessions/:sessionId/messages",
      code: 200,
    });
    expect(http.keys.session).toBe(SID);
    expect(http.bytes).toBeGreaterThan(0);
    expect(http.durMs).toBeGreaterThanOrEqual(0);

    const open = samples.find((s) => s.probe === "session.messages")!;
    expect(open.keys).toMatchObject({ request, session: SID });
    expect(open.attrs).toMatchObject({ kind: "tail", shards: 1, reachesEnd: true });
    expect(open.n).toBeGreaterThan(0);
    expect(open.bytes).toBeGreaterThan(0);

    const shard = samples.find((s) => s.probe === "trace.read")!;
    expect(shard.keys).toMatchObject({ request, session: SID });
    expect(shard.n).toBe(5);
    expect(shard.attrs?.shard).toMatch(/^[0-9a-f]{12}$/);

    // Shape only: no message text, no path, no key made it into any sample.
    const dump = JSON.stringify(samples);
    expect(dump).not.toContain(SECRET_TEXT);
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain("traces");
  });

  it("serves the per-probe and per-session views", async () => {
    await turn(true);
    await openSession();
    await openSession();
    const probes = (await read("?view=probes")).probes ?? [];
    const opens = probes.find((p) => p.probe === "session.messages")!;
    expect(opens.count).toBe(2);
    expect(opens.p50Ms).not.toBeNull();
    const sessions = (await read(`?view=sessions&session=${SID}`)).sessions ?? [];
    expect(sessions.map((s) => s.session)).toEqual([SID]);
    expect(sessions[0]!.probes.map((p) => p.probe)).toEqual(
      expect.arrayContaining(["http.request", "session.messages", "trace.read"]),
    );
  });

  it("records every node of a new generation's boot, under its generation number", async () => {
    await turn(true);
    expect(await t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()).toBe(
      true,
    );
    const boot = (await read("?view=samples")).samples ?? [];
    const modules = boot.filter((s) => s.probe === "boot.module");
    expect(modules.map((s) => s.attrs?.module)).toEqual(
      expect.arrayContaining(["TelemetryService", "HttpModule", "Startup"]),
    );
    for (const probe of ["boot.migrate", "boot.plugins", "boot.modules", "boot.create"]) {
      expect(
        boot.find((s) => s.probe === probe),
        probe,
      ).toBeDefined();
    }
    // The test App's first create was generation 1; the re-assembly is the second.
    expect(
      new Set(boot.filter((s) => s.probe.startsWith("boot.")).map((s) => s.keys.generation)),
    ).toEqual(new Set([2]));
    let quiet: TelemetrySample | undefined;
    for (let i = 0; i < 100 && quiet === undefined; i++) {
      quiet = ((await read("?view=samples&probe=boot.quiet")).samples ?? [])[0];
      if (quiet === undefined) await new Promise((r) => setTimeout(r, 20));
    }
    expect(quiet?.keys.generation).toBe(2);
  });

  it("answers a non-admin 403, and clears and switches off for an admin", async () => {
    await turn(true);
    await openSession();
    const { cookie } = await provisionUser(t.app, "member");
    const member = apiClient(t.app, cookie);
    expect((await member.get("/api/telemetry")).status).toBe(403);
    expect((await member.delete("/api/telemetry")).status).toBe(403);
    expect((await member.put("/api/admin/settings", { telemetry: false })).status).toBe(403);

    expect((await read()).buffered).toBeGreaterThan(0);
    expect((await admin.delete("/api/telemetry")).status).toBe(200);
    // The DELETE itself is the one request recorded after the clear.
    expect((await read("?view=samples&probe=session.messages")).samples).toEqual([]);

    await turn(false);
    expect(await read()).toMatchObject({ enabled: false, buffered: 0 });
  });
});
