/**
 * A Session-level request for a Session that a machine holds, through this server's real routes
 * (machines/session-forward.ts) to a machine served in-process over node:http and its API socket:
 * the request names only the Session, and this server finds the machine and forwards it there.
 *
 * - Given a Session in this server's own index, the request is answered here, even when a
 *   machine holds the same id, and no machine is asked.
 * - Given an admin's request for a machine's Session, it reaches that machine with its query,
 *   carrying the session this server minted there and none of the caller's own credentials; the
 *   machine's answer comes back, and a later request goes straight to it without asking again.
 * - Given a caller who is not an admin, even a member of the machine's Project, the answer is the
 *   Session routes' 404 and no machine is asked.
 * - Given an id that no machine holds, the answer is the Session routes' 404, and asking again
 *   at once reaches no machine.
 * - Given a machine that refuses this server's session (401), the answer is 502
 *   `machine_refused` naming the machine, never a 401 the client would read as its own sign-out.
 * - Given a known Session whose machine is not connected, the answer is 503 `not_connected`
 *   naming the machine.
 * - Given a Session deleted on its machine (through this server, or there), the next request
 *   asks the machines again instead of trusting the old answer.
 * - Given a stream asked for over the API socket, the machine's frames are relayed over the
 *   socket held to the machine, straight into the caller's answer.
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { ADMIN_USER_ID } from "../src/auth/service.js";
import type { Http } from "../src/http/app.js";
import { machineApi } from "../src/machines/machine-api.js";
import { StreamAnswer, carryStreamAnswer } from "../src/socket/stream-answer.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, tokenClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeMachinesNode } from "./fixtures/machines.js";

const MACHINE = "QS7J4YVgSovi-Z2c";
const ALIAS = "box";
const PROJECT = "default_project";
const MINTED = "penguin_session=minted-over-ssh";

const sid = (n: number) => `session-2026-10-22-09-00-00-0000000${n}`;
const LOCAL = sid(1);

/** What the machine holds, by Session id; a test removes one to delete it "over there". */
const held = new Set<string>([LOCAL, sid(2), sid(3), sid(4), sid(5), sid(6), sid(7), sid(8)]);
/** Every HTTP request the machine received. */
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders }[] = [];
/** Every call frame the machine's API socket received. */
const socketCalls: { call: { path: string } }[] = [];
let connected = true;

let machine: http.Server;
let wss: WebSocketServer;
let port = 0;
let t: TestApp;
let admin: string;

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** The machine's server: its Session routes, answered from `held`. */
function answer(req: http.IncomingMessage, res: http.ServerResponse): void {
  seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
  const [, id, rest = ""] = /^\/api\/sessions\/([^/?]+)([^?]*)/.exec(req.url ?? "") ?? [];
  if (id === undefined || !held.has(id)) {
    json(res, 404, { error: { code: "session_not_found", message: "No such Session." } });
  } else if (rest === "/goal") {
    json(res, 401, { error: { code: "unauthorized", message: "Not signed in." } });
  } else if (req.method === "DELETE" && rest === "") {
    held.delete(id);
    res.statusCode = 204;
    res.end();
  } else if (rest === "") {
    json(res, 200, { session: { sessionId: id, projectId: PROJECT } });
  } else {
    json(res, 200, { on: "machine", path: req.url });
  }
}

/**
 * The requests the machine received for one Session's own path: how often it was asked whether
 * it holds the Session (the scenarios forward only paths beneath it).
 */
const asks = (id: string) =>
  seen.filter((r) => r.method === "GET" && r.url === `/api/sessions/${id}`);
const about = (id: string) => seen.filter((r) => r.url.includes(id));

beforeAll(async () => {
  machine = http.createServer(answer);
  wss = new WebSocketServer({ server: machine });
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as { id: number; call: { path: string } };
      socketCalls.push(frame);
      ws.send(JSON.stringify({ id: frame.id, status: 200, stream: true, headers: {} }));
      ws.send(JSON.stringify({ id: frame.id, event: "message", eventId: "7", data: '{"n":1}' }));
      ws.send(JSON.stringify({ id: frame.id, end: true, reason: "closed" }));
    });
  });
  await new Promise<void>((resolve) => machine.listen(0, "127.0.0.1", resolve));
  port = (machine.address() as { port: number }).port;

  t = await createTestApp({
    machines: fakeMachinesNode(
      (projectId) =>
        projectId !== PROJECT
          ? []
          : [
              {
                machineId: MACHINE,
                alias: ALIAS,
                api: connected ? machineApi(new http.Agent(), port, MINTED) : null,
              },
            ],
      (machineId) =>
        machineId === MACHINE && connected
          ? { agent: new http.Agent(), port, cookie: MINTED, adoptedAt: null, session: 1 }
          : null,
    ),
  });
  admin = (await loginAdmin(t.app)).cookie;
  t.deps.sessionsRepo.insert({
    sessionId: LOCAL,
    projectId: PROJECT,
    agentId: "default_agent",
    provider: "custom",
    modelId: "m-x",
    workspace: "/tmp/session-forward-local",
    approvalMode: "allow-all",
    title: "here",
    client: "web",
    hasTrace: false,
    createdAt: "2026-10-22T09:00:00.000Z",
    lastActiveAt: "2026-10-22T09:00:00.000Z",
  });
});

afterAll(async () => {
  await t?.cleanup();
  for (const ws of wss?.clients ?? []) ws.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  machine.closeAllConnections();
  await new Promise<void>((resolve) => machine.close(() => resolve()));
});

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: Record<string, string> } }).error;

describe("a Session-level request for a machine's Session", () => {
  it("is answered here when this server holds the Session, even if a machine holds the same id", async () => {
    const res = await apiClient(t.app, admin).get(`/api/sessions/${LOCAL}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { session: { title: string } }).session.title).toBe("here");
    expect(about(LOCAL)).toEqual([]);
  });

  it("reaches the machine as this server's session there, with none of the caller's credentials", async () => {
    const id = sid(2);
    const token = t.deps.authService.localApiToken()!;
    const res = await tokenClient(t.app, token).get(`/api/sessions/${id}/messages?limit=5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      on: "machine",
      path: `/api/sessions/${id}/messages?limit=5`,
    });
    const forwarded = seen.find((r) => r.url === `/api/sessions/${id}/messages?limit=5`)!;
    expect(forwarded.headers.cookie).toBe(MINTED);
    expect(forwarded.headers.authorization).toBeUndefined();

    // Known from now on: the next request goes straight to the machine.
    await apiClient(t.app, admin).get(`/api/sessions/${id}/messages`);
    expect(asks(id)).toHaveLength(1);
  });

  it("is the Session routes' 404 for a caller who is not an admin, and asks no machine", async () => {
    const id = sid(3);
    const bob = await provisionUser(t.app, "bob");
    // A member of the Project the machine serves: only being an admin would take him there.
    const added = await apiClient(t.app, admin).post(`/api/projects/${PROJECT}/members`, {
      userId: "bob",
    });
    expect(added.status).toBe(201);
    const res = await apiClient(t.app, bob.cookie).get(`/api/sessions/${id}`);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("session_not_found");
    expect(about(id)).toEqual([]);
  });

  it("is the Session routes' 404 for an id no machine holds, and asking again at once reaches no machine", async () => {
    const id = "session-2026-10-22-09-00-00-deadbeef";
    for (let i = 0; i < 2; i += 1) {
      const res = await apiClient(t.app, admin).get(`/api/sessions/${id}`);
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("session_not_found");
    }
    expect(asks(id)).toHaveLength(1);
  });

  it("answers a machine's refusal as 502 machine_refused naming the machine, never as a 401", async () => {
    const res = await apiClient(t.app, admin).get(`/api/sessions/${sid(4)}/goal`);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toMatchObject({
      code: "machine_refused",
      details: { machineId: MACHINE, alias: ALIAS },
    });
  });

  it("answers 503 not_connected naming the machine when the Session's machine is not connected", async () => {
    const id = sid(5);
    expect((await apiClient(t.app, admin).get(`/api/sessions/${id}`)).status).toBe(200);
    connected = false;
    try {
      const res = await apiClient(t.app, admin).get(`/api/sessions/${id}/messages`);
      expect(res.status).toBe(503);
      expect(await errorOf(res)).toMatchObject({
        code: "not_connected",
        details: { machineId: MACHINE, alias: ALIAS },
      });
    } finally {
      connected = true;
    }
  });

  it("asks the machines again once a Session is deleted on its machine, here or there", async () => {
    const client = apiClient(t.app, admin);
    // Deleted through this server.
    const viaHere = sid(6);
    expect((await client.get(`/api/sessions/${viaHere}/messages`)).status).toBe(200);
    expect((await client.delete(`/api/sessions/${viaHere}`)).status).toBe(204);
    expect((await client.get(`/api/sessions/${viaHere}/messages`)).status).toBe(404);
    expect(asks(viaHere)).toHaveLength(2);

    // Deleted on the machine: its own 404 passes through, and the next request asks again.
    const viaThere = sid(7);
    expect((await client.get(`/api/sessions/${viaThere}/messages`)).status).toBe(200);
    held.delete(viaThere);
    const gone = await client.get(`/api/sessions/${viaThere}/messages`);
    expect(gone.status).toBe(404);
    expect((await errorOf(gone)).code).toBe("session_not_found");
    expect((await client.get(`/api/sessions/${viaThere}/messages`)).status).toBe(404);
    expect(asks(viaThere)).toHaveLength(2);
  });

  it("relays a stream asked for over the API socket from the machine's socket into the caller's answer", async () => {
    const id = sid(8);
    const frames: unknown[] = [];
    const answer = new StreamAnswer(
      1,
      (frame) => frames.push(frame),
      new AbortController(),
      () => false,
    );
    // The platform's entry for a call the API socket carried (hmr/platform.ts), as that user.
    const platform = t.boot.tree.api<Http>("ApiModule", "Http");
    const request = new Request(`http://localhost/api/sessions/${id}/stream`, {
      headers: { accept: "text/event-stream" },
    });
    await platform.fetchAs(ADMIN_USER_ID, carryStreamAnswer(request, answer));
    await answer.done;

    expect(socketCalls.map((frame) => frame.call.path)).toEqual([`/api/sessions/${id}/stream`]);
    expect(frames).toEqual([
      expect.objectContaining({ id: 1, status: 200, stream: true }),
      { id: 1, event: "message", eventId: "7", data: '{"n":1}' },
      { id: 1, end: true, reason: "closed" },
    ]);
  });
});
