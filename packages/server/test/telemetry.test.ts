/**
 * Telemetry end to end on a test App (PRFC-0008): the switch, the three fixed probes (a
 * request, a generation's boot, a session open), the admin read route, and what must not
 * happen — nothing recorded while off, no content in a sample, no read for a non-admin.
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
  };

  it("is off by default: nothing is recorded", async () => {
    const res = await admin.get("/api/admin/settings");
    expect(((await res.json()) as ServerSettingsResponse).settings.telemetry).toBe(false);
    await openSession();
    expect(await read("?view=samples")).toMatchObject({ enabled: false, buffered: 0, samples: [] });
  });

  it("records a request and the session open inside it, keyed alike, with no content; serves both views", async () => {
    await turn(true);
    await openSession();
    await openSession();
    const { samples = [] } = await read("?view=samples");
    const http = samples.find(
      (s) => s.probe === "http.request" && s.attrs?.route === "/api/sessions/:sessionId/messages",
    ) as TelemetrySample;
    expect(http).toMatchObject({ keys: { session: SID }, attrs: { method: "GET", code: 200 } });
    const request = http.keys.request;
    expect(request).toMatch(/^[0-9a-f-]{36}$/);
    const inside = samples.filter((s) => s.keys.request === request).map((s) => s.probe);
    expect(inside).toEqual(expect.arrayContaining(["session.messages", "trace.read"]));
    const open = samples.find((s) => s.keys.request === request && s.probe === "session.messages");
    expect(open).toMatchObject({
      status: "ok",
      keys: { session: SID },
      attrs: { kind: "tail" },
    });
    expect(
      samples.find((s) => s.keys.request === request && s.probe === "trace.read"),
    ).toMatchObject({
      attrs: { messages: 5 },
      keys: { session: SID },
    });
    const dump = JSON.stringify(samples);
    for (const content of [SECRET_TEXT, KEY, "traces"]) expect(dump).not.toContain(content);

    expect(
      (await read("?view=probes")).probes?.find((p) => p.probe === "session.messages")?.count,
    ).toBe(2);
    const sessions = (await read(`?view=sessions&session=${SID}`)).sessions ?? [];
    expect(sessions.map((s) => s.session)).toEqual([SID]);
  });

  it("records a new generation's boot, node by node, under its generation number", async () => {
    await turn(true);
    expect(await t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()).toBe(
      true,
    );
    const boot = ((await read("?view=samples")).samples ?? []).filter((s) =>
      s.probe.startsWith("boot."),
    );
    expect(boot.filter((s) => s.probe === "boot.module").map((s) => s.attrs?.module)).toEqual(
      expect.arrayContaining(["TelemetryService", "HttpModule", "Startup"]),
    );
    expect(new Set(boot.map((s) => s.probe))).toEqual(
      new Set(["boot.migrate", "boot.plugins", "boot.module", "boot.modules", "boot.create"]),
    );
    // The test App's first create was generation 1; the re-assembly is the second.
    expect(new Set(boot.map((s) => s.keys.generation))).toEqual(new Set([2]));
    await expect
      .poll(
        async () =>
          ((await read("?view=samples&probe=boot.quiet")).samples ?? [])[0]?.keys.generation,
      )
      .toBe(2);
  });

  it("answers a non-admin 403, and clears and switches off for an admin", async () => {
    await turn(true);
    await openSession();
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect((await member.get("/api/telemetry")).status).toBe(403);
    expect((await member.delete("/api/telemetry")).status).toBe(403);
    expect((await member.put("/api/admin/settings", { telemetry: false })).status).toBe(403);
    expect((await admin.delete("/api/telemetry")).status).toBe(200);
    expect((await read("?view=samples&probe=session.messages")).samples).toEqual([]);
    await turn(false);
    expect(await read()).toMatchObject({ enabled: false, buffered: 0 });
  });
});
