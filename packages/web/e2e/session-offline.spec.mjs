/**
 * The Web App sees one remote machine. Its forward reaches the e2e server over loopback
 * while connected. The hub runs the production machine proxy, history sync and disk cache.
 * Browser calls for the rest of the application go to the regular authenticated server.
 *
 * - After the machine disconnects, previously read history opens in a fresh tab and says
 *   where the copy came from. Another Session whose history the hub never read says so.
 * - Once the machine reconnects, a tab showing cached history catches up with messages
 *   written on the machine while it was away. The reader stays on the same conversation.
 */
import { test, expect } from "@playwright/test";
import { Agent } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const project = "/api/projects/default_project";
const machineId = "QS7J4YVgSovi-Z2c";
const prefix = "/server/" + machineId;
const base = process.env.BASE_URL;

async function fixture(context, sessions) {
  // The server bundles its routes into the executable. Compile the same routes for this
  // isolated hub, beside their actual dependencies, then dispose of the bundle with it.
  const server = fileURLToPath(new URL("../../server/", import.meta.url));
  const bundle = await mkdtemp(join(server, "node_modules/.offline-e2e-"));
  const outfile = join(bundle, "hub.mjs");
  await build({
    stdin: {
      resolveDir: join(server, "src"),
      contents: [
        'export { machineHistory } from "./machines/history-routes";',
        'export { machinesProxy } from "./machines/proxy";',
        'export { MachineSockets } from "./machines/machine-sockets";',
        'export { SessionForward } from "./machines/session-forward";',
        'export { SessionMachineIndex } from "./machines/session-index";',
        'export { MachineSocketRelay } from "./machines/socket-relay";',
        'export { TraceCache } from "./machines/trace-cache";',
        'export { carryStreamAnswer, StreamAnswer } from "./socket/stream-answer";',
      ].join("\n"),
    },
    bundle: true,
    platform: "node",
    target: "node24",
    tsconfig: join(server, "tsconfig.json"),
    format: "esm",
    packages: "external",
    outfile,
  });
  const {
    machineHistory,
    machinesProxy,
    MachineSockets,
    TraceCache,
    SessionForward,
    SessionMachineIndex,
    MachineSocketRelay,
    carryStreamAnswer,
    StreamAnswer,
  } = await import(pathToFileURL(outfile).href);
  const root = await mkdtemp(join(tmpdir(), "session-offline-"));
  const sockets = new MachineSockets(() => {});
  const agent = new Agent();
  const target = {
    agent,
    port: Number(new URL(base).port),
    cookie: (await context.cookies(base)).map((c) => c.name + "=" + c.value).join("; "),
    adoptedAt: null,
    session: 1,
  };
  const machine = {
    machineId,
    id: "ssh:Office",
    alias: "Office",
    local: false,
    member: true,
    installed: { version: "1", at: new Date().toISOString() },
    connection: { pid: 1 },
    socket: null,
    api: null,
    status: null,
    root: "/tmp",
  };
  const resolve = async () => (machine.connection === null ? null : target);
  const { history, sync } = machineHistory({
    cache: new TraceCache(root),
    sockets,
    target: resolve,
    log: () => {},
  });
  const remote = machinesProxy(resolve, undefined, undefined, { history, sockets });
  const index = new SessionMachineIndex();
  for (const sid of sessions) index.note(sid, machineId, "default_project");
  const forward = new SessionForward({
    machines: {
      proxyTarget: resolve,
      projectApis: async () => [machine],
      noteApiSeen: () => {},
    },
    relay: new MachineSocketRelay(() => {}, { sockets }),
    index,
    history,
  });
  const subscribers = new Map();
  await context.routeWebSocket(
    (url) => url.pathname === "/api/socket",
    (ws) => {
      const local = ws.connectToServer();
      const active = new Map();
      const send = (frame) => ws.send(JSON.stringify(frame));
      local.onMessage((message) => {
        const frame = JSON.parse(message);
        // Only this server's own activity reaches its local event stream. The fixture's two
        // Sessions belong to the machine, including tasks it completes while disconnected.
        if (
          frame.id === subscribers.get(ws) &&
          frame.event === "server_event" &&
          sessions.includes(JSON.parse(frame.data).sessionId)
        )
          return;
        ws.send(message);
      });
      ws.onClose(() => {
        subscribers.delete(ws);
        for (const call of active.values()) call.controller.abort();
        local.close();
      });
      ws.onMessage(async (message) => {
        const { id, call, cancel, ack } = JSON.parse(message);
        const pending = active.get(id);
        if (pending) {
          if (cancel) pending.controller.abort();
          if (typeof ack === "number") pending.answer?.ack(ack);
          return;
        }
        if (!call) return local.send(message);
        const { method, path, body, headers } = call;
        if (path === "/api/events") subscribers.set(ws, id);
        if (path === project + "/machines") {
          return send({
            id,
            status: 200,
            body: { machines: [machine], imageVersion: "1", job: null, jobs: [] },
          });
        }
        if (path === project + "/sessions/batch") {
          // The conversations being tested live on the machine, not on this server's list.
          return send({
            id,
            status: 200,
            body: {
              results: body.requests.map(({ agentId }) => ({
                agentId,
                ok: true,
                sessions: [],
                counts: { active: 0, background: 0, archived: 0 },
              })),
            },
          });
        }
        const sessionRead = sessions.some((sid) => path.split(/[/?]/)[3] === sid);
        if (!path.startsWith(prefix + "/") && !sessionRead) return local.send(message);
        const controller = new AbortController();
        const request = new Request(new URL(path, base), {
          method,
          headers:
            body === undefined ? headers : { ...headers, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const answer =
          headers?.accept === "text/event-stream"
            ? new StreamAnswer(id, send, controller, () => false)
            : null;
        active.set(id, { controller, answer });
        try {
          const req = answer ? carryStreamAnswer(request, answer) : request;
          const res = path.startsWith(prefix + "/")
            ? await remote(req, { userId: ADMIN_ID, projectId: "default_project" })
            : await forward.forward(req, path.split(/[/?]/)[3], ["default_project"], {
                userId: ADMIN_ID,
              });
          if (answer?.started) await answer.done;
          else {
            const text = await res.text();
            send({ id, status: res.status, body: text ? JSON.parse(text) : null });
          }
        } finally {
          active.delete(id);
        }
      });
    },
  );
  return {
    async setConnected(connected) {
      if (!connected) {
        const held = await sockets.socketFor(machineId, target);
        machine.connection = null;
        held.socket?.terminate();
        agent.destroy();
      } else {
        machine.connection = { pid: ++target.session };
      }
      for (const [ws, id] of subscribers) {
        ws.send(
          JSON.stringify({
            id,
            event: "server_event",
            data: JSON.stringify({ type: "machines_changed" }),
          }),
        );
      }
    },
    async close() {
      await context.close();
      sync.close();
      sockets.close();
      agent.destroy();
      await Promise.all([root, bundle].map((dir) => rm(dir, { recursive: true, force: true })));
    },
  };
}

async function message(request, id, text) {
  const sent = await request.post("/api/sessions/" + id + "/tasks", {
    data: { input: [{ type: "text", text }] },
  });
  expect(sent.ok(), await sent.text()).toBeTruthy();
  await expect
    .poll(async () => {
      const response = await request.get("/api/sessions/" + id);
      return (await response.json()).session.status;
    })
    .toBe("idle");
}

test("cached remote history opens in another tab while disconnected and catches up on reconnect", async ({
  context,
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const model = { provider: "custom", modelId: "claude-4-8" };
  const config = await page.request.put(project + "/models", {
    data: {
      defaultModel: model,
      models: [
        { ...model, apiKey: "sk-mock", baseUrl: process.env.MOCK_URL, contextWindow: 200000 },
      ],
    },
  });
  expect(config.ok(), await config.text()).toBeTruthy();
  const create = async (text) => {
    const res = await page.request.post(project + "/agents/default_agent/sessions", {
      data: model,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const sid = (await res.json()).session.sessionId;
    await message(page.request, sid, text);
    return sid;
  };
  const old = "Inspect the archived contract before publishing";
  const fresh = "New material recorded while the machine was away";
  const cold = "A previous task that the hub has never opened";
  const warmId = await create(old);
  const coldId = await create(cold);
  const hub = await fixture(context, [warmId, coldId]);
  const offline = (p) => p.getByRole("status").filter({ hasText: /Office is not connected/i });
  const transcript = (p, text) =>
    p.locator('[data-find-region="conversation"]').getByText(text, { exact: true });
  try {
    // /chat would first open the most recent Session and already warm the cold fixture.
    await page.goto("/chat/new");
    await page.locator("[data-session-id='" + warmId + "']").click();
    await expect(transcript(page, old)).toBeVisible();
    await expect(offline(page)).toHaveCount(0);
    await hub.setConnected(false);
    await expect(offline(page)).toBeVisible();
    await expect(transcript(page, old)).toBeVisible();
    const second = await context.newPage();
    await second.goto("/chat/" + warmId);
    await expect(offline(second)).toContainText(/last sync/i);
    await expect(transcript(second, old)).toBeVisible();
    await expect(second.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await page.locator("[data-session-id='" + coldId + "']").click();
    await expect(offline(page)).toContainText(/no cached history/i);
    await expect(transcript(page, old)).toHaveCount(0);
    await expect(transcript(page, cold)).toHaveCount(0);
    // A link may be opened from a browser with no remembered rows for this machine.
    const direct = await context.newPage();
    await direct.addInitScript((owner) => {
      localStorage.removeItem("penguin.machineSessions.default_project:" + owner);
    }, machineId);
    await direct.goto("/chat/" + warmId);
    await expect(offline(direct)).toContainText(/last sync/i);
    await expect(transcript(direct, old)).toBeVisible();
    await message(page.request, warmId, fresh);
    await expect(transcript(second, fresh)).toHaveCount(0);
    await hub.setConnected(true);
    await expect(transcript(second, fresh)).toBeVisible();
    await expect(offline(second)).toHaveCount(0);
    await expect(second).toHaveURL(new RegExp(warmId + "$"));
    await expect(transcript(direct, fresh)).toBeVisible();
    await expect(offline(direct)).toHaveCount(0);
    await expect(transcript(page, cold)).toBeVisible();
  } finally {
    await hub.close();
  }
});
