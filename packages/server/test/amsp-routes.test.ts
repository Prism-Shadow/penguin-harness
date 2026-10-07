/**
 * The Agent API on the wire: the real Hono app, requests in, response bytes out, read the way a
 * client reads them (the client package's `readSse` over the body). Sessions are fake runtimes adopted as API
 * Sessions (fixtures/session.ts) playing scripted streams, except where creating a Session is
 * the point: those run a real core Session against a loopback model (live-session.ts).
 *
 * Scenarios — the gate:
 * - Given a keyed Agent, a run without a key is refused 401 before its body is read (a body
 *   that is not even JSON gets the 401), and nothing is created.
 * - Given a wrong key, the answer is 401; a key deleted on the API tab is refused from the next
 *   request on.
 * - Given another Agent's key, the answer is the 404 an unknown Agent gets, body for body.
 * - Given an Agent whose API switch is off, existing or not, the answer is that same 404.
 * - Given the admin switch off, every route answers 403 `agent_api_disabled` but the preflight.
 * - Given an Agent that allows keyless access, a keyless run streams and carries no
 *   Access-Control-Allow-Origin; with keyless access off it is 401.
 * - Given a key, every response carries Access-Control-Allow-Origin *, errors included; a
 *   preflight is answered without one.
 * - Given a body the server-wide checks refuse before the group is reached (over the body cap:
 *   413; not JSON: 415), a keyed request still carries Access-Control-Allow-Origin *, so a
 *   browser reads the code rather than a CORS failure; a keyless one carries none.
 * - Given an unknown path under the prefix, the answer is a JSON 404 — not the SPA, not a 401.
 *
 * Scenarios — runs:
 * - Given a run without session_id, a Session is created with client `api` and source `api`
 *   and run.started names it; the stream is the real Session's projected — its toolset, one
 *   Request answering, run.done completed — and does not echo the input.
 * - Given the Agent's API approval mode, the Session a run creates carries it; changing the
 *   mode on the tab leaves that Session as it was, and a PATCH on the Session moves it.
 * - Given a run with session_id, the same Session continues and its runtime receives the new
 *   input only, texts before images, none of it streamed back.
 * - Given a Session the Web App created, or another Agent's API Session, the answer is 404
 *   `session_not_found`.
 * - Given a busy Session, a second run is 409 and nothing is streamed.
 * - Given a Session whose Trace is gone, so that loading it heals it into a new id, the run is
 *   followed there: run.started names the new id and the stream runs to its end.
 * - Given an Agent with four runs going, a fifth is 429 with Retry-After, and creates nothing.
 * - Given each scripted stream, the caller reads exactly the fixture's events, ending with one
 *   run.done and then [DONE] (the approval script answered through the approvals route, which
 *   has nothing left to decide afterwards).
 * - Given the Web App's approval card answering first, the run goes on and the caller's answer
 *   finds nothing pending.
 * - Given a caller that disconnects mid-run, the run is aborted.
 * - Given an explicit abort, the stream ends with run.done aborted; aborting an idle Session is
 *   a 204.
 * - Given a malformed body, the answer is 400 `bad_request` naming the field — an oversized or
 *   non-image data URL, a file item, too many image bytes included — and nothing is created.
 * - Given 15 s of silence, a `: keep-alive` comment is written (fake timers).
 * - Given a failure of the server's own while driving, the stream ends with run.done fatal
 *   `internal` and [DONE], and the run is stopped.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  abortEvent,
  assistantText,
  partialText,
  requestBegin,
  requestEnd,
} from "@prismshadow/penguin-core";
import type { OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core";
import { readSse } from "@prismshadow/amsp";
import type { AmspEvent } from "@prismshadow/amsp";
import type { AgentApiKeyCreateResponse, ApprovalMode, SessionResponse } from "../src/api/types.js";
import type { RuntimeSession, SessionLoader } from "../src/runtime/session-manager.js";
import { bodyLimitBytes } from "../src/services/attachment-limits.js";
import { apiClient, createTestApp, loginAdmin, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import {
  AMSP_FIXTURE_NOW,
  AMSP_STREAM_SCRIPTS,
  APPROVAL_ROUND_TRIP,
} from "./fixtures/amsp-stream.js";
import type { AmspStreamScript } from "./fixtures/amsp-stream.js";
import { MOCK_MODEL_ID, startMockLLM } from "./live-session.js";
import type { MockLLM } from "./live-session.js";

const P = "default_project";
const A = "default_agent";
const PREFIX = "/api/amsp/v1";

type Admin = ReturnType<typeof apiClient>;

/** One request to the public group: a key when given, a JSON body when given. */
async function amsp(
  t: TestApp,
  path: string,
  init: { method?: string; key?: string; body?: unknown; raw?: string } = {},
): Promise<Response> {
  const hasBody = init.body !== undefined || init.raw !== undefined;
  return await t.app.request(`${PREFIX}${path}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: {
      ...(init.key !== undefined ? { authorization: `Bearer ${init.key}` } : {}),
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    ...(hasBody ? { body: init.raw ?? JSON.stringify(init.body) } : {}),
  });
}

/** A response body read event by event, as a client reads it. */
function stream(res: Response) {
  const body = res.body!;
  const reader = readSse(body);
  return {
    /** The next `data:` payload, parsed; "[DONE]" as the string; undefined once the body ends. */
    async next(): Promise<AmspEvent | "[DONE]" | undefined> {
      const r = await reader.next();
      if (r.done) return undefined;
      return r.value === "[DONE]" ? "[DONE]" : (JSON.parse(r.value) as AmspEvent);
    },
    /** Events up to and including the first of `type`. */
    async until(type: AmspEvent["type"]): Promise<AmspEvent[]> {
      const out: AmspEvent[] = [];
      for (;;) {
        const item = await this.next();
        if (item === undefined || item === "[DONE]") throw new Error(`no ${type} before the end`);
        out.push(item);
        if (item.type === type) return out;
      }
    },
    /** Everything left, to the end of the body. */
    async rest(): Promise<Array<AmspEvent | "[DONE]">> {
      const out: Array<AmspEvent | "[DONE]"> = [];
      for (let item = await this.next(); item !== undefined; item = await this.next()) {
        out.push(item);
      }
      return out;
    },
    /** The caller goes away: a reader that has started cancels the body as it stops. */
    async disconnect(): Promise<void> {
      await reader.return(undefined);
      if (!body.locked) await body.cancel();
    },
  };
}

/** The events with every server-stamped `at` checked and pinned, so they compare to a fixture. */
function pinned(events: Array<AmspEvent | "[DONE]">): Array<AmspEvent | "[DONE]"> {
  return events.map((e) => {
    if (e === "[DONE]") return e;
    if (e.type === "run.started" || e.type === "run.done" || e.type === "approval.requested") {
      expect(Number.isNaN(Date.parse(e.at))).toBe(false);
      return { ...e, at: AMSP_FIXTURE_NOW };
    }
    return e;
  });
}

/**
 * A runtime that starts a request, then waits — for `release()` or an abort — and records what
 * each run was given and whether it was aborted.
 */
function blocking(sessionId: string) {
  let release: () => void = () => {};
  const runs: Array<{ input: OmniMessage[]; signal: AbortSignal }> = [];
  const session = fakeSession(sessionId, {
    async *run(input, { signal }) {
      runs.push({ input, signal });
      const released = new Promise<void>((resolve) => (release = resolve));
      yield requestBegin();
      yield partialText("start");
      yield partialText("delta", "Working");
      await Promise.race([
        released,
        new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
      ]);
      if (signal.aborted) {
        yield requestEnd("aborted", { attempt: 1 });
        yield abortEvent("user_abort");
        return;
      }
      yield assistantText("Working");
      yield requestEnd("completed");
    },
  });
  return { session, runs, release: () => release() };
}

/** A runtime that plays a script, asking for approval where the script does. */
function scripted(script: AmspStreamScript, decisions: string[] = []): RuntimeSession {
  return fakeSession(script.sessionId, {
    async *run(_input, { approve }) {
      for (const step of script.steps) {
        if ("approve" in step) {
          const call: OmniMessage<ToolCallPayload> = {
            timestamp: AMSP_FIXTURE_NOW,
            type: "model_msg",
            payload: {
              type: "tool_call",
              role: "assistant",
              ...step.approve,
              stop_reason: "completed",
            },
          };
          decisions.push(await approve(call));
        } else {
          yield step.message as unknown as OmniMessage;
        }
      }
    },
  });
}

/** Turns an Agent's API on and mints a key for it; returns the key. */
async function expose(admin: Admin, agentId: string, settings: object = {}): Promise<string> {
  const base = `/api/projects/${P}/agents/${agentId}/api`;
  expect((await admin.put(base, { enabled: true, ...settings })).status).toBe(200);
  const res = await admin.post(`${base}/keys`, { name: `${agentId} suite` });
  expect(res.status).toBe(201);
  return ((await res.json()) as AgentApiKeyCreateResponse).secret;
}

async function createAgent(admin: Admin, agentId: string): Promise<void> {
  expect((await admin.post(`/api/projects/${P}/agents`, { agentId })).status).toBe(201);
}

async function errorOf(res: Response): Promise<{ status: number; code: string; body: string }> {
  const body = await res.text();
  return {
    status: res.status,
    code: (JSON.parse(body) as { error: { code: string } }).error.code,
    body,
  };
}

describe("Agent API: the gate", () => {
  let t: TestApp;
  let admin: Admin;
  let key: string;
  let otherKey: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    key = await expose(admin, A);
    await createAgent(admin, "other_agent");
    otherKey = await expose(admin, "other_agent");
    await createAgent(admin, "dark_agent");
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
  });

  it("a run without a key on a keyed Agent is refused 401 before the body is read", async () => {
    const before = t.deps.sessionsRepo.listByAgent(P, A).length;
    const res = await amsp(t, `/agents/${P}/${A}/runs`, { raw: "{not json" });
    expect(await errorOf(res)).toMatchObject({ status: 401, code: "unauthorized" });
    expect(t.deps.sessionsRepo.listByAgent(P, A)).toHaveLength(before);
  });

  it("a wrong key is 401, and a deleted key is 401 from the next request on", async () => {
    expect((await amsp(t, `/agents/${P}/${A}`, { key: "test-agent-key" })).status).toBe(401);
    const created = (await (
      await admin.post(`/api/projects/${P}/agents/${A}/api/keys`, { name: "short-lived" })
    ).json()) as AgentApiKeyCreateResponse;
    expect((await amsp(t, `/agents/${P}/${A}`, { key: created.secret })).status).toBe(200);
    expect(
      (await admin.delete(`/api/projects/${P}/agents/${A}/api/keys/${created.key.keyId}`)).status,
    ).toBe(204);
    expect(
      await errorOf(await amsp(t, `/agents/${P}/${A}`, { key: created.secret })),
    ).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("a key of another Agent is 404 agent_not_found, the same body as for an unknown Agent", async () => {
    const theirs = await errorOf(await amsp(t, `/agents/${P}/${A}`, { key: otherKey }));
    const unknown = await errorOf(await amsp(t, `/agents/${P}/no_such_agent`, { key }));
    expect(theirs).toMatchObject({ status: 404, code: "agent_not_found" });
    expect(theirs.body).toBe(unknown.body);
    // The same key opens its own Agent.
    const own = await amsp(t, `/agents/${P}/other_agent`, { key: otherKey });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ agent: { id: `${P}/other_agent` } });
  });

  it("an Agent whose switch is off is 404 whether or not it exists", async () => {
    const dark = await errorOf(
      await amsp(t, `/agents/${P}/dark_agent/runs`, { body: { input: "hi" } }),
    );
    const ghost = await errorOf(await amsp(t, `/agents/${P}/ghost_agent`));
    const badId = await errorOf(await amsp(t, `/agents/${P}/..%2Fescape`));
    expect(dark).toMatchObject({ status: 404, code: "agent_not_found" });
    expect(ghost.body).toBe(dark.body);
    expect(badId.body).toBe(dark.body);
    // Switching it off again takes an exposed Agent back out of reach.
    await admin.put(`/api/projects/${P}/agents/other_agent/api`, { enabled: false });
    try {
      expect(
        (await errorOf(await amsp(t, `/agents/${P}/other_agent`, { key: otherKey }))).body,
      ).toBe(dark.body);
    } finally {
      await admin.put(`/api/projects/${P}/agents/other_agent/api`, { enabled: true });
    }
  });

  it("the admin switch off answers 403 to every route but preflight", async () => {
    const sessionId = uniqueSessionId();
    adoptSession(t.deps, fakeSession(sessionId), { projectId: P, agentId: A, client: "api" });
    expect((await admin.put("/api/admin/settings", { agentApiEnabled: false })).status).toBe(200);
    try {
      const refused = [
        amsp(t, `/agents/${P}/${A}`, { key }),
        amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "hi" } }),
        amsp(t, `/sessions/${sessionId}`, { key }),
        amsp(t, `/sessions/${sessionId}/abort`, { key, method: "POST" }),
        amsp(t, `/sessions/${sessionId}/approvals/call_1`, { key, body: { decision: "allow" } }),
        amsp(t, `/no/such/route`),
      ];
      for (const res of await Promise.all(refused)) {
        expect(await errorOf(res)).toMatchObject({ status: 403, code: "agent_api_disabled" });
      }
      const preflight = await amsp(t, `/agents/${P}/${A}/runs`, { method: "OPTIONS" });
      expect(preflight.status).toBe(204);
    } finally {
      await admin.put("/api/admin/settings", { agentApiEnabled: true });
    }
    expect((await amsp(t, `/sessions/${sessionId}`, { key })).status).toBe(200);
  });

  it("an open Agent accepts a keyless run and sends no Access-Control-Allow-Origin", async () => {
    const sessionId = uniqueSessionId();
    const { session, release } = blocking(sessionId);
    adoptSession(t.deps, session, { projectId: P, agentId: A, client: "api" });
    await admin.put(`/api/projects/${P}/agents/${A}/api`, { open: true });
    try {
      const res = await amsp(t, `/agents/${P}/${A}/runs`, {
        body: { session_id: sessionId, input: "no key" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const events = stream(res);
      await events.until("text.delta");
      release();
      expect((await events.rest()).at(-1)).toBe("[DONE]");
    } finally {
      await admin.put(`/api/projects/${P}/agents/${A}/api`, { open: false });
    }
    const closed = await amsp(t, `/agents/${P}/${A}/runs`, {
      body: { session_id: sessionId, input: "no key" },
    });
    expect(await errorOf(closed)).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("a keyed response carries Access-Control-Allow-Origin * and preflight is answered without a key", async () => {
    const ok = await amsp(t, `/agents/${P}/${A}`, { key });
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    const refused = await amsp(t, `/sessions/${uniqueSessionId()}`, { key });
    expect(refused.status).toBe(404);
    expect(refused.headers.get("access-control-allow-origin")).toBe("*");

    const sessionId = uniqueSessionId();
    const { session, release } = blocking(sessionId);
    adoptSession(t.deps, session, { projectId: P, agentId: A, client: "api" });
    const streamed = await amsp(t, `/agents/${P}/${A}/runs`, {
      key,
      body: { session_id: sessionId, input: "hi" },
    });
    expect(streamed.headers.get("access-control-allow-origin")).toBe("*");
    release();
    await stream(streamed).rest();

    const preflight = await amsp(t, `/agents/${P}/${A}/runs`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    expect(preflight.headers.get("access-control-max-age")).toBe("600");
  });

  it("a keyed request the server-wide body checks refuse still carries Access-Control-Allow-Origin *", async () => {
    const cap = bodyLimitBytes(t.deps.serverSettingsRepo.getAttachmentLimitsMb());
    const oversized = (headers: Record<string, string>) =>
      t.app.request(`${PREFIX}/agents/${P}/${A}/runs`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "content-length": `${cap + 1}` },
        body: JSON.stringify({ input: "small" }),
      });
    const notJson = (headers: Record<string, string>) =>
      t.app.request(`${PREFIX}/agents/${P}/${A}/runs`, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain" },
        body: "hello",
      });
    for (const [send, status, code] of [
      [oversized, 413, "payload_too_large"],
      [notJson, 415, "unsupported_media_type"],
    ] as const) {
      const keyed = await send({ authorization: `Bearer ${key}` });
      expect(keyed.headers.get("access-control-allow-origin")).toBe("*");
      expect(await errorOf(keyed)).toMatchObject({ status, code });
      const keyless = await send({});
      expect(keyless.headers.get("access-control-allow-origin")).toBeNull();
      expect(await errorOf(keyless)).toMatchObject({ status, code });
    }
  });

  it("an unknown path under the prefix is a JSON 404, not the SPA and not a 401", async () => {
    for (const path of ["/nope", `/agents/${P}`, "/", `/sessions`]) {
      const res = await amsp(t, path);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await errorOf(res)).toMatchObject({ status: 404, code: "not_found" });
    }
    const keyed = await amsp(t, `/agents/${P}/${A}/whatever`, { key, body: {} });
    expect(await errorOf(keyed)).toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("Agent API: runs", () => {
  let t: TestApp;
  let admin: Admin;
  let key: string;
  let mock: MockLLM;
  /** What loading a Session that is not in memory gives (the self-heal case sets it). */
  let load: SessionLoader["load"] = () => Promise.reject(new Error("nothing to load here"));

  beforeAll(async () => {
    mock = await startMockLLM((n) => `reply ${n}`);
    // Titles stay off, so the model is asked for the runs alone.
    t = await createTestApp({
      titles: { maybeGenerate: () => {} },
      loader: { load: (row) => load(row) },
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const models = await admin.put(`/api/projects/${P}/models`, {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [
        {
          provider: "custom",
          modelId: MOCK_MODEL_ID,
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
      ],
    });
    expect(models.status).toBe(200);
    key = await expose(admin, A);
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  const session = async (sessionId: string): Promise<SessionResponse["session"]> =>
    ((await (await admin.get(`/api/sessions/${sessionId}`)).json()) as SessionResponse).session;

  it("a run without session_id creates a Session with client api and source api and names it in run.started", async () => {
    const res = await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "Say hello" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const items = await stream(res).rest();
    const started = items[0] as Extract<AmspEvent, { type: "run.started" }>;
    expect(started).toMatchObject({ type: "run.started", agent: `${P}/${A}` });
    // The real Session's stream: its toolset (first run), one Request answering, the end.
    const events = items.filter((e): e is AmspEvent => e !== "[DONE]");
    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      "tools.ready",
      "request.started",
      "text.delta",
      "text.delta",
      "text.done",
      "request.done",
      "run.done",
    ]);
    expect(events.find((e) => e.type === "text.done")).toMatchObject({
      text: expect.stringMatching(/^reply \d+$/),
    });
    const done = events.at(-1) as Extract<AmspEvent, { type: "run.done" }>;
    expect(done).toMatchObject({ status: "completed", requests: 1 });
    expect(done.usage.total).toBeGreaterThan(0);
    expect(done.usage).toEqual(done.session_usage);
    expect(items.at(-1)).toBe("[DONE]");

    const created = await session(started.session_id);
    expect(created).toMatchObject({ client: "api", source: "api", agentId: A });
    // The caller reads the same Session back through the API.
    const info = await amsp(t, `/sessions/${started.session_id}`, { key });
    expect(await info.json()).toMatchObject({
      session: {
        id: started.session_id,
        agent: `${P}/${A}`,
        status: "idle",
        model_id: MOCK_MODEL_ID,
      },
    });
  });

  it("the created Session carries the Agent's API approval mode; the tab does not move it, a PATCH on the Session does", async () => {
    const tab = `/api/projects/${P}/agents/${A}/api`;
    await admin.put(tab, { approvalMode: "read-only" });
    try {
      const first = await stream(
        await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "one" } }),
      ).rest();
      const sessionId = (first[0] as Extract<AmspEvent, { type: "run.started" }>).session_id;
      expect((await session(sessionId)).approvalMode).toBe("read-only");

      await admin.put(tab, { approvalMode: "deny-all" });
      expect((await session(sessionId)).approvalMode).toBe("read-only");
      expect(
        (await admin.patch(`/api/sessions/${sessionId}`, { approvalMode: "always-ask" })).status,
      ).toBe(200);
      expect((await session(sessionId)).approvalMode).toBe("always-ask");

      const second = await stream(
        await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "two" } }),
      ).rest();
      const next = (second[0] as Extract<AmspEvent, { type: "run.started" }>).session_id;
      expect((await session(next)).approvalMode).toBe("deny-all");
    } finally {
      await admin.put(tab, { approvalMode: "allow-all" });
    }
  });

  it("a run with session_id continues the same Session and the runtime receives the new input only", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, runs, release } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const image = "https://img.test/cat.png";
    const inputs = [
      [{ type: "text", text: "first" }],
      // Items arrive texts first, then images, whatever order they were sent in.
      [
        { type: "image_url", image_url: image },
        { type: "text", text: "second" },
      ],
    ];
    for (const input of inputs) {
      const events = stream(
        await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { session_id: sessionId, input } }),
      );
      expect(await events.next()).toMatchObject({ type: "run.started", session_id: sessionId });
      await events.until("text.delta");
      release();
      const rest = await events.rest();
      // The run's own input is the caller's: it is not streamed back.
      const echoed = rest.filter(
        (e) =>
          e !== "[DONE]" &&
          (e.type === "image_url.done" || (e.type === "text.done" && e.role === "user")),
      );
      expect(echoed).toEqual([]);
    }
    const received = runs.map((r) =>
      r.input.map((m) => {
        const p = m.payload as { text?: string; image_url?: string };
        return p.text ?? p.image_url;
      }),
    );
    expect(received).toEqual([["first"], ["second", image]]);
  });

  it("a web-created Session, or another Agent's API Session, is 404 session_not_found", async () => {
    const web = uniqueSessionId();
    adoptSession(t.deps, fakeSession(web), { projectId: P, agentId: A, client: "web" });
    const theirs = uniqueSessionId();
    adoptSession(t.deps, fakeSession(theirs), {
      projectId: P,
      agentId: "agent_creator",
      client: "api",
    });
    for (const sessionId of [web, theirs]) {
      const run = await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "hi" },
      });
      expect(await errorOf(run)).toMatchObject({ status: 404, code: "session_not_found" });
    }
    expect(await errorOf(await amsp(t, `/sessions/${web}`, { key }))).toMatchObject({
      status: 404,
      code: "session_not_found",
    });
  });

  it("a busy Session is 409 and nothing is streamed", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, runs, release } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const first = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { session_id: sessionId, input: "a" } }),
    );
    await first.until("text.delta");
    const second = await amsp(t, `/agents/${P}/${A}/runs`, {
      key,
      body: { session_id: sessionId, input: "b" },
    });
    expect(second.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await errorOf(second)).toMatchObject({ status: 409, code: "task_in_progress" });
    release();
    await first.rest();
    expect(runs).toHaveLength(1);
  });

  it("a Session healed into a new id as it loads is followed: run.started names the new id and the run streams to its end", async () => {
    const stale = uniqueSessionId();
    const healed = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(stale, { projectId: P, agentId: A, client: "api" }));
    load = async () =>
      fakeSession(healed, {
        async *run() {
          // A real engine's first record follows its bootstrap I/O.
          await new Promise((resolve) => setImmediate(resolve));
          yield requestBegin();
          yield assistantText("healed");
          yield requestEnd("completed");
        },
      });
    const items = await stream(
      await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { session_id: stale, input: "hi" } }),
    ).rest();
    expect(items[0]).toMatchObject({ type: "run.started", session_id: healed });
    expect(items.find((e) => e !== "[DONE]" && e.type === "text.done")).toMatchObject({
      text: "healed",
    });
    expect(items.slice(-2)).toEqual([
      expect.objectContaining({ type: "run.done", status: "completed" }),
      "[DONE]",
    ]);
  });

  it("the fifth concurrent run of an Agent is 429 with Retry-After, and creates nothing", async () => {
    await createAgent(admin, "busy_agent");
    const busyKey = await expose(admin, "busy_agent");
    const running = Array.from({ length: 4 }, () => blocking(uniqueSessionId()));
    const streams = [];
    for (const r of running) {
      adoptSession(t.deps, r.session, { projectId: P, agentId: "busy_agent", client: "api" });
      const s = stream(
        await amsp(t, `/agents/${P}/busy_agent/runs`, {
          key: busyKey,
          body: { session_id: r.session.sessionId, input: "go" },
        }),
      );
      await s.until("text.delta");
      streams.push(s);
    }
    const idle = uniqueSessionId();
    adoptSession(t.deps, fakeSession(idle), { projectId: P, agentId: "busy_agent", client: "api" });
    const before = t.deps.sessionsRepo.listByAgent(P, "busy_agent").length;
    for (const body of [{ input: "fifth" }, { session_id: idle, input: "fifth" }]) {
      const res = await amsp(t, `/agents/${P}/busy_agent/runs`, { key: busyKey, body });
      expect(res.headers.get("retry-after")).toBe("2");
      expect(await errorOf(res)).toMatchObject({ status: 429, code: "too_many_runs" });
    }
    expect(t.deps.sessionsRepo.listByAgent(P, "busy_agent")).toHaveLength(before);
    for (const r of running) r.release();
    for (const s of streams) await s.rest();
  });

  it.each(AMSP_STREAM_SCRIPTS.map((s) => [s.name, s] as const))(
    "%s reaches the caller as the fixture records it, ending with exactly one run.done then [DONE]",
    async (_name, script) => {
      const decisions: string[] = [];
      adoptSession(t.deps, scripted(script, decisions), {
        projectId: P,
        agentId: A,
        client: "api",
        approvalMode: script.approvalMode as ApprovalMode,
      });
      const res = await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: script.sessionId, input: script.input },
      });
      const events = stream(res);
      const read: Array<AmspEvent | "[DONE]"> = [];
      const asks = script.steps.filter((s) => "approve" in s).length;
      for (let i = 0; i < asks; i++) {
        const upTo = await events.until("approval.requested");
        read.push(...upTo);
        const ask = upTo.at(-1) as Extract<AmspEvent, { type: "approval.requested" }>;
        const path = `/sessions/${script.sessionId}/approvals/${ask.tool_call.tool_call_id}`;
        expect((await amsp(t, path, { key, body: { decision: "allow" } })).status).toBe(204);
        // Decided: a second answer finds nothing pending.
        const again = await amsp(t, path, { key, body: { decision: "deny" } });
        expect(await errorOf(again)).toMatchObject({ status: 404, code: "approval_not_found" });
      }
      read.push(...(await events.rest()));
      expect(pinned(read)).toEqual([...script.events, "[DONE]"]);
      expect(read.filter((e) => e !== "[DONE]" && e.type === "run.done")).toHaveLength(1);
      expect(decisions).toEqual(Array.from({ length: asks }, () => "allow"));
    },
  );

  it("the Web App's approval route answers the same request, and the caller's answer then finds nothing", async () => {
    const script = { ...APPROVAL_ROUND_TRIP, sessionId: uniqueSessionId() };
    const decisions: string[] = [];
    adoptSession(t.deps, scripted(script, decisions), {
      projectId: P,
      agentId: A,
      client: "api",
      approvalMode: "always-ask",
    });
    const events = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: script.sessionId, input: script.input },
      }),
    );
    await events.until("approval.requested");
    const web = await admin.post(`/api/sessions/${script.sessionId}/approvals/call_1`, {
      decision: "allow",
    });
    expect(web.status).toBe(204);
    const late = await amsp(t, `/sessions/${script.sessionId}/approvals/call_1`, {
      key,
      body: { decision: "deny" },
    });
    expect(await errorOf(late)).toMatchObject({ status: 404, code: "approval_not_found" });
    const rest = await events.rest();
    expect(rest.at(-2)).toMatchObject({ type: "run.done", status: "completed" });
    expect(decisions).toEqual(["allow"]);
  });

  it("a client that disconnects mid-run aborts it", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, runs } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const events = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      }),
    );
    await events.until("text.delta");
    await events.disconnect();
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");
    expect(runs[0]!.signal.aborted).toBe(true);
  });

  it("an explicit abort ends the stream with run.done aborted", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const events = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      }),
    );
    await events.until("text.delta");
    expect((await amsp(t, `/sessions/${sessionId}/abort`, { key, method: "POST" })).status).toBe(
      202,
    );
    const rest = await events.rest();
    expect(rest.at(-2)).toMatchObject({
      type: "run.done",
      status: "aborted",
      error: { code: "user_abort" },
    });
    expect(rest.at(-1)).toBe("[DONE]");
    expect((await amsp(t, `/sessions/${sessionId}/abort`, { key, method: "POST" })).status).toBe(
      204,
    );
  });

  it.each([
    ["a body that is not JSON", "{", "JSON"],
    ["no input", {}, "input"],
    ["an empty text item", { input: [{ type: "text", text: " " }] }, "input[0].text"],
    ["a session_id that is not an id", { input: "hi", session_id: "../x" }, "session_id"],
    [
      "a file item",
      { input: [{ type: "file", fileName: "a.txt", dataBase64: "aGk=" }] },
      "input[0]",
    ],
    [
      "a data URL that is not an image",
      { input: [{ type: "image_url", image_url: "data:text/plain;base64,aGk=" }] },
      "input[0].image_url",
    ],
    [
      "an image over the inline cap",
      {
        input: [
          {
            type: "image_url",
            image_url: `data:image/png;base64,${Buffer.alloc(21 * 1024 * 1024).toString("base64")}`,
          },
        ],
      },
      "input[0].image_url",
    ],
    ["an unknown item type", { input: [{ type: "audio" }] }, "input[0].type"],
  ])("%s is 400 bad_request naming the field, and creates nothing", async (_case, body, field) => {
    const before = t.deps.sessionsRepo.listByAgent(P, A).length;
    const res = await amsp(t, `/agents/${P}/${A}/runs`, {
      key,
      ...(typeof body === "string" ? { raw: body } : { body }),
    });
    const error = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(400);
    expect(error.error.code).toBe("bad_request");
    expect(error.error.message).toContain(field);
    expect(t.deps.sessionsRepo.listByAgent(P, A)).toHaveLength(before);
  });

  it("images over the per-message total are 400 bad_request", async () => {
    expect(
      (await admin.put("/api/admin/settings", { attachmentMaxMb: 1, attachmentTotalMb: 1 })).status,
    ).toBe(200);
    try {
      const image = `data:image/png;base64,${Buffer.alloc(700 * 1024).toString("base64")}`;
      const res = await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: {
          input: [
            { type: "image_url", image_url: image },
            { type: "image_url", image_url: image },
          ],
        },
      });
      expect(await errorOf(res)).toMatchObject({ status: 400, code: "bad_request" });
    } finally {
      await admin.put("/api/admin/settings", { attachmentTotalMb: 120, attachmentMaxMb: 100 });
    }
  });

  it("a keep-alive comment is written after 15 s of silence", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, release } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const res = await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const readUntil = async (needle: string): Promise<void> => {
        while (!text.includes(needle)) {
          const { done, value } = await reader.read();
          if (done) throw new Error(`the body ended before ${JSON.stringify(needle)}`);
          text += decoder.decode(value, { stream: true });
        }
      };
      await readUntil('"text.delta","at"');
      await readUntil('"text":"Working"');
      expect(text).not.toContain(": keep-alive");
      await vi.advanceTimersByTimeAsync(15_000);
      await readUntil(": keep-alive\n\n");
      release();
      await readUntil("data: [DONE]\n\n");
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a server failure while driving ends the stream with run.done fatal internal and [DONE], and stops the run", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, runs } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const events = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      }),
    );
    await events.until("text.delta");
    // A record the translator cannot read stands in for any failure of the server's own.
    t.deps.channels
      .get(sessionId)
      .publish({ timestamp: new Date().toISOString(), type: "model_msg", payload: null });
    const rest = await events.rest();
    expect(rest.at(-2)).toMatchObject({
      type: "run.done",
      status: "fatal",
      error: { code: "internal" },
    });
    expect(rest.at(-1)).toBe("[DONE]");
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");
    expect(runs[0]!.signal.aborted).toBe(true);
  });
});
