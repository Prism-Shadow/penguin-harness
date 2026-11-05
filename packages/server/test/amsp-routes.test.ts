/**
 * The Agent API's gate, admission and refusals on the wire: the real Hono app, requests in,
 * response bytes out, read the way a client reads them (the SDK's `readAmsp` over the body).
 * Where a scenario is about admission rather than a stream, its Session is a fake runtime adopted
 * as an API Session (fixtures/session.ts) that holds its run open until released; where creating
 * a Session is the point, a real core Session runs against a loopback model (live-session.ts).
 * What a stream carries — records, control frames, approvals, the Session routes — is
 * amsp-session-stream.test.ts.
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
 * - Given a configured limit, public and Try-it runs share it, concurrent arrivals reserve
 *   capacity before creation, edits take effect immediately, and failed starts release it.
 * - Simultaneous requests on one idle Session yield one run and a 409, preserving busy semantics.
 * - Given API model, thinking and workspace defaults, new public and Try-it Sessions use them;
 *   continuing a Session preserves its choices, clearing defaults restores normal creation,
 *   and a removed workspace refuses creation without leaving a Session behind.
 * - Given a run without session_id, a Session is created with client `api` and source `api`
 *   and the stream's first record, its session_meta, names it; the stream ends with [DONE] and
 *   its records read completed.
 * - Given the Agent's API approval mode, the Session a run creates carries it; changing the
 *   mode on the tab leaves that Session as it was, and a PATCH on the Session moves it.
 * - Given a run with session_id, the same Session continues and its runtime receives the new
 *   input only, texts before images, which the stream echoes in that order.
 * - Given a Session the Web App created, or another Agent's API Session, the answer is 404
 *   `session_not_found`.
 * - Given a busy Session, a second run is 409 and nothing is streamed.
 * - Given an Agent with four runs going, a fifth is 429 with Retry-After, and creates nothing.
 * - Given the Web App's approval card answering first, the run goes on and the caller's answer
 *   finds nothing pending.
 * - Given a caller that disconnects mid-run, the run is aborted.
 * - Given an explicit abort, the stream ends with an abort record and [DONE]; aborting an idle
 *   Session is a 204.
 * - Given a malformed body, the answer is 400 `bad_request` naming the field — an oversized or
 *   non-image data URL, a file item, too many image bytes included — and nothing is created.
 * - Given a run stream, `event: ping` opens it and is written every 20 s after (fake timers);
 *   there is no `: keep-alive` comment.
 *
 * Scenarios — the API tab's try route (`POST /api/projects/:p/agents/:a/api/try`, the owner's
 * sign-in in place of a key):
 * - Given the owner's cookie, the try route streams what a keyed run streams, record kind for
 *   record kind: its session_meta names a Session with client `api`, source `api` and the
 *   Agent's API approval mode, and [DONE] ends it; no key's last use moves.
 * - Given a member who is not the owner, the answer is 403 `owner_required`; a user outside the
 *   Project gets 404, a signed-out request 401; none of them creates anything.
 * - Given the Agent's switch off, or no such Agent, the answer is 404 `agent_not_found`; given
 *   the admin's switch off, 403 `agent_api_disabled` — the public routes' own refusals.
 * - Given a session_id, an API Session of the Agent continues; a web Session's id is 404
 *   `session_not_found`.
 * - Given four runs of the Agent going through the try route, a fifth is 429 there and on the
 *   public route alike.
 * - Given a malformed body, the answer is the public route's 400 `bad_request`, byte for byte.
 * - Given a caller that disconnects from the try stream, the run is aborted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  abortEvent,
  approvalDecision,
  assistantText,
  partialText,
  requestBegin,
  requestEnd,
  taskBegin,
  taskEnd,
  toolCall,
} from "@prismshadow/penguin-core";
import { RunCollector, readAmsp } from "@prismshadow/amsp";
import type { AmspFrame, AmspRecord, RunResult } from "@prismshadow/amsp";
import type {
  AgentApiKeyCreateResponse,
  AgentApiResponse,
  SessionResponse,
} from "../src/api/types.js";
import { bodyLimitBytes } from "../src/services/attachment-limits.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
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

/** The last frame of a run stream. */
const DONE: AmspFrame = { kind: "done" };

/** A record as the assertions name it: its payload type, or `session_meta`. */
const kindOf = (r: AmspRecord): string =>
  r.type === "session_meta" ? "session_meta" : ((r.payload as { type?: string }).type ?? r.type);

const recordsOf = (frames: AmspFrame[]): AmspRecord[] =>
  frames.flatMap((f) => (f.kind === "record" ? [f.record] : []));

/** The opening frame of a run stream. */
const PING: AmspFrame = { kind: "control", control: { kind: "ping" } };

/** The new Session a run stream names: its main session_meta's. */
function sessionOf(frames: AmspFrame[]): string {
  const meta = recordsOf(frames).find((r) => r.type === "session_meta" && !r.origin?.length);
  if (meta === undefined) throw new Error("no session_meta");
  return (meta.payload as { session_id: string }).session_id;
}

/** The run's result, as the SDK folds its records; `sessionId` is the Session a run continued. */
function resultOf(frames: AmspFrame[], sessionId?: string): RunResult {
  const collector = new RunCollector(sessionId !== undefined ? { sessionId } : {});
  for (const r of recordsOf(frames)) collector.add(r);
  return collector.result();
}

/** A response body read frame by frame, as a client reads it. */
function stream(res: Response) {
  const body = res.body!;
  const reader = readAmsp(body);
  return {
    /** The next frame; undefined once the body ends. */
    async next(): Promise<AmspFrame | undefined> {
      const r = await reader.next();
      return r.done ? undefined : r.value;
    },
    /** Frames up to and including the first record of `kind`. */
    async until(kind: string): Promise<AmspFrame[]> {
      const out: AmspFrame[] = [];
      for (;;) {
        const item = await this.next();
        if (item === undefined || item.kind === "done")
          throw new Error(`no ${kind} before the end`);
        out.push(item);
        if (item.kind === "record" && kindOf(item.record) === kind) return out;
      }
    },
    /** Everything left, to the end of the body. */
    async rest(): Promise<AmspFrame[]> {
      const out: AmspFrame[] = [];
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

/**
 * A runtime that starts a request, then waits — for `release()` or an abort — and records what
 * each run was given and whether it was aborted.
 */
function blocking(sessionId: string) {
  let release: () => void = () => {};
  const runs: Array<{ input: AmspRecord[]; signal: AbortSignal }> = [];
  const session = fakeSession(sessionId, {
    async *run(input, { signal }) {
      runs.push({ input, signal });
      const released = new Promise<void>((resolve) => (release = resolve));
      yield taskBegin();
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
        yield taskEnd();
        return;
      }
      yield assistantText("Working");
      yield requestEnd("completed");
      yield taskEnd();
    },
  });
  return { session, runs, release: () => release() };
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
      await events.until("partial_text");
      release();
      expect((await events.rest()).at(-1)).toEqual(DONE);
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

  beforeAll(async () => {
    mock = await startMockLLM((n) => `reply ${n}`);
    // Titles stay off, so the model is asked for the runs alone.
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const models = await admin.put(`/api/projects/${P}/models`, {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [
        {
          provider: "custom",
          modelId: "claude-api-model",
          clientType: "ant-messages",
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
        {
          provider: "custom",
          modelId: MOCK_MODEL_ID,
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
      ],
    });
    expect(models.status, await models.text()).toBe(200);
    key = await expose(admin, A);
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  const session = async (sessionId: string): Promise<SessionResponse["session"]> =>
    ((await (await admin.get(`/api/sessions/${sessionId}`)).json()) as SessionResponse).session;

  it("a run without session_id creates a Session with client api and source api and names it with its session_meta", async () => {
    const res = await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "Say hello" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const items = await stream(res).rest();
    expect(items[0]).toEqual(PING);
    expect(items[1]).toMatchObject({ kind: "record", record: { type: "session_meta" } });
    expect(items.at(-1)).toEqual(DONE);
    const result = resultOf(items);
    expect(result).toMatchObject({ status: "completed", requests: 1 });
    expect(result.text).toMatch(/^reply \d+$/);
    expect(result.usage.total).toBeGreaterThan(0);
    expect(result.usage).toEqual(result.sessionUsage);

    const created = await session(result.sessionId);
    expect(created).toMatchObject({ client: "api", source: "api", agentId: A });
    // The caller reads the same Session back through the API.
    const info = await amsp(t, `/sessions/${result.sessionId}`, { key });
    expect(await info.json()).toMatchObject({
      session: {
        id: result.sessionId,
        agent: `${P}/${A}`,
        status: "idle",
        model_id: MOCK_MODEL_ID,
      },
    });
  });

  it("new runs use the API defaults, existing sessions keep theirs, and clearing restores defaults", async () => {
    const fs = await import("node:fs/promises");
    const workspace = await fs.realpath(await fs.mkdtemp(`${t.root}/api-workspace-`));
    const tab = `/api/projects/${P}/agents/${A}/api`;
    const model = { provider: "custom", modelId: "claude-api-model" };
    const firstId = async (res: Response, continued?: string) => {
      if (res.status !== 200) throw new Error(await res.text());
      const events = await stream(res).rest();
      expect(resultOf(events, continued).status).toBe("completed");
      return continued ?? sessionOf(events);
    };
    try {
      expect((await admin.put(tab, { model, thinkingLevel: "high", workspace })).status).toBe(200);
      const id = await firstId(
        await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "one" } }),
      );
      expect(await session(id)).toMatchObject({ ...model, thinkingLevel: "high", workspace });
      await admin.put(tab, { model: null, thinkingLevel: "low", workspace: null });
      await firstId(
        await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { session_id: id, input: "two" } }),
        id,
      );
      expect(await session(id)).toMatchObject({ ...model, thinkingLevel: "high", workspace });
      const tried = await firstId(await admin.post(`${tab}/try`, { input: "three" }));
      expect(await session(tried)).toMatchObject({
        provider: "custom",
        modelId: MOCK_MODEL_ID,
        thinkingLevel: "low",
      });
      expect((await session(tried)).workspace).not.toBe(workspace);
      await admin.put(tab, { thinkingLevel: null, workspace, maxConcurrentRuns: 1 });
      await fs.rm(workspace, { recursive: true });
      const count = t.deps.sessionsRepo.listByAgent(P, A).length;
      const refused = await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "four" } });
      expect(await errorOf(refused)).toMatchObject({ status: 400, code: "workspace_not_found" });
      expect(t.deps.sessionsRepo.listByAgent(P, A)).toHaveLength(count);
      await admin.put(tab, { workspace: null });
      await firstId(await admin.post(`${tab}/try`, { input: "after failed creation" }));
    } finally {
      await admin.put(tab, {
        model: null,
        thinkingLevel: null,
        workspace: null,
        maxConcurrentRuns: 4,
      });
    }
  });

  it("the created Session carries the Agent's API approval mode; the tab does not move it, a PATCH on the Session does", async () => {
    const tab = `/api/projects/${P}/agents/${A}/api`;
    await admin.put(tab, { approvalMode: "read-only" });
    try {
      const first = await stream(
        await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "one" } }),
      ).rest();
      const sessionId = sessionOf(first);
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
      const next = sessionOf(second);
      expect((await session(next)).approvalMode).toBe("deny-all");
    } finally {
      await admin.put(tab, { approvalMode: "allow-all" });
    }
  });

  it("a run with session_id continues the same Session; the runtime receives the new input only, and the stream echoes it", async () => {
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
      expect(await events.next()).toEqual(PING);
      const upTo = await events.until("partial_text");
      release();
      const rest = await events.rest();
      // The run's input is echoed behind its task_begin, as the Trace holds it.
      const echoed = recordsOf([...upTo, ...rest]).flatMap((r) => {
        const p = r.payload as { type?: string; role?: string; text?: string; image_url?: string };
        if (p.type === "image_url") return [p.image_url];
        return p.type === "text" && p.role === "user" ? [p.text] : [];
      });
      expect(echoed).toEqual(input.length === 1 ? ["first"] : ["second", image]);
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
    await first.until("partial_text");
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
      await s.until("partial_text");
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

  it("shares a configured limit across public and Try-it runs and applies edits without stopping active runs", async () => {
    const agent = "limited_agent";
    await createAgent(admin, agent);
    const limitedKey = await expose(admin, agent);
    const tab = `/api/projects/${P}/agents/${agent}/api`;
    await admin.put(tab, { maxConcurrentRuns: 2 });
    const running = Array.from({ length: 3 }, () => blocking(uniqueSessionId()));
    const streams: ReturnType<typeof stream>[] = [];
    for (const r of running)
      adoptSession(t.deps, r.session, { projectId: P, agentId: agent, client: "api" });
    const publicRun = (i: number) =>
      amsp(t, `/agents/${P}/${agent}/runs`, {
        key: limitedKey,
        body: { session_id: running[i]!.session.sessionId, input: "go" },
      });
    try {
      const responses = await Promise.all([
        publicRun(0),
        admin.post(`${tab}/try`, { session_id: running[1]!.session.sessionId, input: "go" }),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(200);
        const events = stream(res);
        streams.push(events);
        await events.until("partial_text");
      }
      const refused = await publicRun(2);
      expect(refused.headers.get("retry-after")).toBe("2");
      expect(await errorOf(refused)).toMatchObject({ status: 429, code: "too_many_runs" });
      // Raising admits the next run; lowering never aborts the three already underway.
      await admin.put(tab, { maxConcurrentRuns: 3 });
      const admitted = await publicRun(2);
      expect(admitted.status).toBe(200);
      const third = stream(admitted);
      streams.push(third);
      await third.until("partial_text");
      await admin.put(tab, { maxConcurrentRuns: 1 });
      expect(t.deps.manager.activeCountForAgent(P, agent)).toBe(3);
      const before = t.deps.sessionsRepo.listByAgent(P, agent).length;
      expect(await errorOf(await admin.post(`${tab}/try`, { input: "over limit" }))).toMatchObject({
        status: 429,
        code: "too_many_runs",
      });
      expect(t.deps.sessionsRepo.listByAgent(P, agent)).toHaveLength(before);
    } finally {
      for (const r of running) r.release();
      for (const events of streams) await events.rest();
    }
    const next = await admin.post(`${tab}/try`, { input: "capacity returned" });
    expect(next.status).toBe(200);
    expect((await stream(next).rest()).at(-1)).toEqual(DONE);
  });

  it("simultaneous requests on one idle Session keep the 409 busy response", async () => {
    const agent = "same_session_agent";
    await createAgent(admin, agent);
    const sameKey = await expose(admin, agent);
    const tab = `/api/projects/${P}/agents/${agent}/api`;
    await admin.put(tab, { maxConcurrentRuns: 1 });
    const running = blocking(uniqueSessionId());
    adoptSession(t.deps, running.session, { projectId: P, agentId: agent, client: "api" });
    const body = { session_id: running.session.sessionId, input: "go" };
    const responses = await Promise.all([
      amsp(t, `/agents/${P}/${agent}/runs`, { key: sameKey, body }),
      admin.post(`${tab}/try`, body),
    ]);
    try {
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await errorOf(responses.find((r) => r.status === 409)!)).toMatchObject({
        code: "task_in_progress",
      });
    } finally {
      running.release();
      for (const res of responses) if (res.status === 200) await stream(res).rest();
    }
  });

  it("simultaneous new-session requests cannot both claim the last slot", async () => {
    const agent = "racing_agent";
    await createAgent(admin, agent);
    const racingKey = await expose(admin, agent);
    const tab = `/api/projects/${P}/agents/${agent}/api`;
    await admin.put(tab, { maxConcurrentRuns: 1 });
    const before = t.deps.sessionsRepo.listByAgent(P, agent).length;
    const responses = await Promise.all([
      amsp(t, `/agents/${P}/${agent}/runs`, { key: racingKey, body: { input: "public" } }),
      admin.post(`${tab}/try`, { input: "try" }),
      amsp(t, `/agents/${P}/${agent}/runs`, { key: racingKey, body: { input: "public again" } }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    for (const response of responses) {
      if (response.status === 200) expect((await stream(response).rest()).at(-1)).toEqual(DONE);
      else {
        expect(response.headers.get("retry-after")).toBe("2");
        expect(await errorOf(response)).toMatchObject({ code: "too_many_runs" });
      }
    }
    expect(t.deps.sessionsRepo.listByAgent(P, agent)).toHaveLength(before + 1);
  });

  it("the Web App's approval route answers the same request, and the caller's answer then finds nothing", async () => {
    const sessionId = uniqueSessionId();
    const decisions: string[] = [];
    adoptSession(
      t.deps,
      fakeSession(sessionId, {
        async *run(_input, { approve }) {
          yield taskBegin();
          const call = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "call_1" });
          yield call;
          const decision = await approve(call);
          decisions.push(decision);
          yield approvalDecision(decision, "call_1");
          yield taskEnd();
        },
      }),
      { projectId: P, agentId: A, client: "api", approvalMode: "always-ask" },
    );
    const events = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      }),
    );
    await events.until("tool_call");
    await waitFor(() => t.deps.manager.pendingApprovals(sessionId).length === 1);
    const web = await admin.post(`/api/sessions/${sessionId}/approvals/call_1`, {
      decision: "allow",
    });
    expect(web.status).toBe(204);
    const late = await amsp(t, `/sessions/${sessionId}/approvals/call_1`, {
      key,
      body: { decision: "deny" },
    });
    expect(await errorOf(late)).toMatchObject({ status: 404, code: "approval_not_found" });
    const rest = await events.rest();
    expect(rest.at(-1)).toEqual(DONE);
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
    await events.until("partial_text");
    await events.disconnect();
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");
    expect(runs[0]!.signal.aborted).toBe(true);
  });

  it("an explicit abort ends the stream with its abort record and [DONE]", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const events = stream(
      await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      }),
    );
    await events.until("partial_text");
    expect((await amsp(t, `/sessions/${sessionId}/abort`, { key, method: "POST" })).status).toBe(
      202,
    );
    const rest = await events.rest();
    expect(recordsOf(rest).map(kindOf)).toContain("abort");
    expect(rest.at(-1)).toEqual(DONE);
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

  it("a ping opens the stream and goes out every 20 s after, and no keep-alive comment", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, release } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const res = await amsp(t, `/agents/${P}/${A}/runs`, {
        key,
        body: { session_id: sessionId, input: "go" },
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const readUntil = async (needle: string, times = 1): Promise<void> => {
        while (text.split(needle).length - 1 < times) {
          const { done, value } = await reader.read();
          if (done) throw new Error(`the body ended before ${JSON.stringify(needle)}`);
          text += decoder.decode(value, { stream: true });
        }
      };
      await readUntil('"text":"Working"');
      expect(text.startsWith("event: ping\ndata: {}\n\n")).toBe(true);
      expect(text.split("event: ping\n").length - 1).toBe(1);
      await vi.advanceTimersByTimeAsync(20_000);
      await readUntil("event: ping\ndata: {}\n\n", 2);
      expect(text).not.toContain(": keep-alive");
      release();
      await readUntil("data: [DONE]\n\n");
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Agent API: the try route", () => {
  let t: TestApp;
  let admin: Admin;
  let member: Admin;
  let outsider: Admin;
  let key: string;
  let mock: MockLLM;
  const tryPath = (agentId = A) => `/api/projects/${P}/agents/${agentId}/api/try`;

  beforeAll(async () => {
    mock = await startMockLLM((n) => `reply ${n}`);
    // Titles stay off, so the model is asked for the runs alone.
    t = await createTestApp({ titles: { maybeGenerate: () => {} } });
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
    key = await expose(admin, A, { approvalMode: "read-only" });
    member = apiClient(t.app, (await provisionUser(t.app, "try_member")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "try_outsider")).cookie);
    expect((await admin.post(`/api/projects/${P}/members`, { userId: "try_member" })).status).toBe(
      201,
    );
  });
  afterAll(async () => {
    await t.deps.manager.shutdown();
    await t.cleanup();
    await mock.close();
  });

  const lastUses = async (): Promise<Array<string | null>> =>
    (
      (await (await admin.get(`/api/projects/${P}/agents/${A}/api`)).json()) as AgentApiResponse
    ).api.keys.map((k) => k.lastUsedAt);

  /** What a stream carried, frame by frame: records by kind, control frames by name. */
  const shape = (items: AmspFrame[]) =>
    items.map((f) =>
      f.kind === "record" ? kindOf(f.record) : f.kind === "control" ? f.control.kind : f.kind,
    );

  it("the owner's sign-in streams what a keyed run streams; the Session is an API Session with the Agent's approval mode, and no key's last use moves", async () => {
    const keyed = await stream(
      await amsp(t, `/agents/${P}/${A}/runs`, { key, body: { input: "What time is it now?" } }),
    ).rest();
    const used = await lastUses();
    expect(used[0]).not.toBeNull();

    const res = await admin.post(tryPath(), { input: "What time is it now?" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const items = await stream(res).rest();
    expect(shape(items)).toEqual(shape(keyed));
    expect(items.at(-1)).toEqual(DONE);
    expect(resultOf(items)).toMatchObject({ status: "completed", requests: 1 });
    expect(items[0]).toEqual(PING);
    const created = (
      (await (await admin.get(`/api/sessions/${sessionOf(items)}`)).json()) as SessionResponse
    ).session;
    expect(created).toMatchObject({
      client: "api",
      source: "api",
      agentId: A,
      approvalMode: "read-only",
    });
    expect(await lastUses()).toEqual(used);
  });

  it("a member who is not the owner is refused 403 owner_required, a non-member 404, a signed-out request 401, and nothing is created", async () => {
    const before = t.deps.sessionsRepo.listByAgent(P, A).length;
    const body = { input: "What time is it now?" };
    expect(await errorOf(await member.post(tryPath(), body))).toMatchObject({
      status: 403,
      code: "owner_required",
    });
    expect((await outsider.post(tryPath(), body)).status).toBe(404);
    const signedOut = await t.app.request(tryPath(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(signedOut.status).toBe(401);
    expect(t.deps.sessionsRepo.listByAgent(P, A)).toHaveLength(before);
  });

  it("an Agent whose switch is off, or no such Agent, is 404 agent_not_found; the admin's switch off is 403 agent_api_disabled", async () => {
    await createAgent(admin, "dark_try_agent");
    const body = { input: "hi" };
    const dark = await errorOf(await admin.post(tryPath("dark_try_agent"), body));
    const ghost = await errorOf(await admin.post(tryPath("ghost_try_agent"), body));
    expect(dark).toMatchObject({ status: 404, code: "agent_not_found" });
    expect(ghost.body).toBe(dark.body);
    expect((await admin.put("/api/admin/settings", { agentApiEnabled: false })).status).toBe(200);
    try {
      expect(await errorOf(await admin.post(tryPath(), body))).toMatchObject({
        status: 403,
        code: "agent_api_disabled",
      });
    } finally {
      await admin.put("/api/admin/settings", { agentApiEnabled: true });
    }
  });

  it("a try run with session_id continues an API Session of the Agent; a web Session's id is 404 session_not_found", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, runs, release } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const events = stream(
      await admin.post(tryPath(), { session_id: sessionId, input: "And now?" }),
    );
    expect(await events.next()).toEqual(PING);
    await events.until("partial_text");
    release();
    expect((await events.rest()).at(-1)).toEqual(DONE);
    expect(runs.map((r) => r.input.map((m) => (m.payload as { text?: string }).text))).toEqual([
      ["And now?"],
    ]);

    const web = uniqueSessionId();
    adoptSession(t.deps, fakeSession(web), { projectId: P, agentId: A, client: "web" });
    expect(
      await errorOf(await admin.post(tryPath(), { session_id: web, input: "hi" })),
    ).toMatchObject({ status: 404, code: "session_not_found" });
  });

  it("try runs count toward the Agent's four: the fifth is 429 on the try route and the public route alike", async () => {
    await createAgent(admin, "busy_try_agent");
    const busyKey = await expose(admin, "busy_try_agent");
    const running = Array.from({ length: 4 }, () => blocking(uniqueSessionId()));
    const streams = [];
    for (const r of running) {
      adoptSession(t.deps, r.session, { projectId: P, agentId: "busy_try_agent", client: "api" });
      const s = stream(
        await admin.post(tryPath("busy_try_agent"), {
          session_id: r.session.sessionId,
          input: "go",
        }),
      );
      await s.until("partial_text");
      streams.push(s);
    }
    const before = t.deps.sessionsRepo.listByAgent(P, "busy_try_agent").length;
    const viaTry = await admin.post(tryPath("busy_try_agent"), { input: "fifth" });
    const viaKey = await amsp(t, `/agents/${P}/busy_try_agent/runs`, {
      key: busyKey,
      body: { input: "fifth" },
    });
    for (const res of [viaTry, viaKey]) {
      expect(res.headers.get("retry-after")).toBe("2");
      expect(await errorOf(res)).toMatchObject({ status: 429, code: "too_many_runs" });
    }
    expect(t.deps.sessionsRepo.listByAgent(P, "busy_try_agent")).toHaveLength(before);
    for (const r of running) r.release();
    for (const s of streams) await s.rest();
  });

  it.each([
    ["no input", {}],
    ["a session_id that is not an id", { input: "hi", session_id: "../x" }],
    ["a file item", { input: [{ type: "file", fileName: "a.txt", dataBase64: "aGk=" }] }],
  ])("%s is the public route's 400 bad_request, byte for byte", async (_case, body) => {
    const viaTry = await errorOf(await admin.post(tryPath(), body));
    const viaKey = await errorOf(await amsp(t, `/agents/${P}/${A}/runs`, { key, body }));
    expect(viaTry).toMatchObject({ status: 400, code: "bad_request" });
    expect(viaTry.body).toBe(viaKey.body);
  });

  it("a client that disconnects from the try stream aborts the run", async () => {
    const sessionId = uniqueSessionId();
    const { session: runtime, runs } = blocking(sessionId);
    adoptSession(t.deps, runtime, { projectId: P, agentId: A, client: "api" });
    const events = stream(await admin.post(tryPath(), { session_id: sessionId, input: "go" }));
    await events.until("partial_text");
    await events.disconnect();
    await waitFor(() => t.deps.manager.statusOf(sessionId) === "idle");
    expect(runs[0]!.signal.aborted).toBe(true);
  });
});
