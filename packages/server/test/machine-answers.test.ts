/**
 * A machine's JSON answers on their way through this server (machines/proxy.ts): compressed on
 * the link to the machine, and asked again with the validator of the answer kept from last time
 * (machines/answer-cache.ts), so an unchanged one crosses as a 304. The machine is a real server
 * on a port (its JSON answers, validators and compression are http/json-*.ts); the link to it is
 * an http.Agent that counts the bytes that came back over it.
 *
 * - Given a JSON read, the machine is asked for `br, gzip` in this server's own name, the answer
 *   crosses compressed, and the caller gets the machine's own bytes, decoded.
 * - Given a machine that ignores `Accept-Encoding` and sends no validator, its answer is relayed
 *   as it came, and the next read asks again in full.
 * - Given the same read again, unchanged, the machine answers 304 and the caller gets the kept
 *   body, byte for byte; a few hundred bytes cross.
 * - Given the answer changed on the machine, the next read brings the new one whole and keeps it.
 * - Given another user, or another Project's path, the answer kept for one is never offered for
 *   the other: their first read carries no validator, even where the machine would accept any.
 * - Given answers past the bound, one too large is not kept and the least recently used go first.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MachineAnswers } from "../src/machines/answer-cache.js";
import { SERVER_PROXY_PREFIX, machinesProxy } from "../src/machines/proxy.js";
import type { ProxyTarget } from "../src/machines/proxy.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MACHINE = "QS7J4YVgSovi-Z2c";
const PROJECT = "/api/projects/default_project";
const MODELS = `${PROJECT}/models`;
const AGENTS = `${PROJECT}/agents`;

/** One request the machine served: what it was asked with, and what it answered. */
interface Heard {
  path: string;
  acceptEncoding: string | null;
  ifNoneMatch: string | null;
  status: number;
}

/** An agent dialling the machine as the ssh forward would, counting every byte it brings back. */
function countingAgent(): { agent: http.Agent; received: () => number } {
  let received = 0;
  const agent = new http.Agent();
  (agent as unknown as { createConnection: unknown }).createConnection = (
    options: net.TcpNetConnectOpts,
  ) => {
    const socket = net.connect(options);
    socket.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
    });
    return socket;
  };
  return { agent, received: () => received };
}

function listening(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

/** Signs in to a served app over the wire, as this server mints its session on a machine. */
function signIn(port: number, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ userId: "admin", password }));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/auth/login",
        method: "POST",
        headers: {
          host: `localhost:${port}`,
          "content-type": "application/json",
          "content-length": String(payload.length),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve(
            (res.headers["set-cookie"] ?? []).map((line) => line.split(";")[0]!.trim()).join("; "),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** The caller's request to this server for one of the machine's paths. */
const asked = (path: string) =>
  new Request(`http://hub.local${SERVER_PROXY_PREFIX}${MACHINE}${path}`, {
    // A browser's own; the link to the machine is not the browser's to describe.
    headers: { "accept-encoding": "gzip;q=0", accept: "application/json" },
  });

describe("a machine's JSON answers through this server", () => {
  let machine: TestApp;
  let server: ReturnType<typeof serve>;
  let port = 0;
  let cookie = "";
  const heard: Heard[] = [];

  beforeAll(async () => {
    machine = await createTestApp();
    port = await new Promise<number>((resolve) => {
      server = serve(
        {
          fetch: async (request: Request) => {
            const res = await machine.app.fetch(request);
            const url = new URL(request.url);
            heard.push({
              path: `${url.pathname}${url.search}`,
              acceptEncoding: request.headers.get("accept-encoding"),
              ifNoneMatch: request.headers.get("if-none-match"),
              status: res.status,
            });
            return res;
          },
          port: 0,
          hostname: "127.0.0.1",
        },
        (info) => resolve((info as AddressInfo).port),
      );
    });
    cookie = await signIn(port, machine.adminPassword);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await machine.cleanup();
  });

  const target = (agent: http.Agent): ProxyTarget => ({
    agent,
    port,
    cookie,
    adoptedAt: null,
    session: 1,
  });
  /** The machine's answer as it gives it to a caller that asks for no encoding. */
  const direct = async (path: string): Promise<Buffer> => {
    const own = await apiClient(machine.app, (await loginAdmin(machine.app)).cookie).get(path);
    expect(own.headers.get("content-encoding")).toBeNull();
    return Buffer.from(await own.arrayBuffer());
  };
  const lastHeard = (path: string) => heard.filter((h) => h.path === path).at(-1);

  it("a JSON read crosses compressed and reaches the caller as the machine's own bytes", async () => {
    const answers = new MachineAnswers();
    const wire = countingAgent();
    const proxy = machinesProxy(async () => target(wire.agent), undefined, undefined, { answers });

    const res = await proxy(asked(MODELS), { userId: "admin" });

    expect(res?.status).toBe(200);
    expect(res!.headers.get("content-encoding")).toBeNull();
    const relayed = Buffer.from(await res!.arrayBuffer());
    const own = await direct(MODELS);
    expect(relayed.equals(own)).toBe(true);
    expect(lastHeard(MODELS)?.acceptEncoding).toBe("br, gzip");
    // Headers included, a fraction of the answer came over the link.
    expect(wire.received()).toBeLessThan(own.byteLength / 4);
  });

  it("an unchanged answer is revalidated with a 304 and the caller gets the kept body", async () => {
    const answers = new MachineAnswers();
    const first = countingAgent();
    const again = countingAgent();
    const own = await direct(MODELS);
    await (
      await machinesProxy(async () => target(first.agent), undefined, undefined, { answers })(
        asked(MODELS),
        { userId: "admin" },
      )
    )?.arrayBuffer();

    const res = await machinesProxy(async () => target(again.agent), undefined, undefined, {
      answers,
    })(asked(MODELS), { userId: "admin" });

    expect(lastHeard(MODELS)).toMatchObject({ status: 304 });
    expect(lastHeard(MODELS)?.ifNoneMatch).toMatch(/^W\/"/);
    expect(res?.status).toBe(200);
    expect(Buffer.from(await res!.arrayBuffer()).equals(own)).toBe(true);
    expect(again.received()).toBeLessThan(1024);
  });

  it("a changed answer comes back whole and is the one kept from then on", async () => {
    const answers = new MachineAnswers();
    const proxy = machinesProxy(async () => target(countingAgent().agent), undefined, undefined, {
      answers,
    });
    const read = async () => {
      const res = await proxy(asked(AGENTS), { userId: "admin" });
      return (await res!.json()) as { agents: { agentId: string }[] };
    };
    const ids = (body: { agents: { agentId: string }[] }) => body.agents.map((a) => a.agentId);
    expect(ids(await read())).not.toContain("helper");

    const created = await apiClient(machine.app, (await loginAdmin(machine.app)).cookie).post(
      AGENTS,
      { agentId: "helper" },
    );
    expect(created.status).toBe(201);
    const changed = await read();
    expect(lastHeard(AGENTS)).toMatchObject({ status: 200 });
    expect(ids(changed)).toContain("helper");

    const kept = await read();
    expect(lastHeard(AGENTS)).toMatchObject({ status: 304 });
    expect(kept).toEqual(changed);
  });
});

describe("a machine older than compressed answers", () => {
  /** Plain JSON, whatever it is asked: no encoding, no validator. */
  const BODY = JSON.stringify({
    rows: Array.from({ length: 200 }, (_, i) => ({ i, name: "row" })),
  });
  const heard: { acceptEncoding?: string; ifNoneMatch?: string }[] = [];
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      heard.push({
        acceptEncoding: req.headers["accept-encoding"],
        ifNoneMatch: req.headers["if-none-match"],
      });
      res.setHeader("content-type", "application/json");
      res.end(BODY);
    });
    port = await listening(server);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("is relayed as it answered, and the next read asks again in full", async () => {
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "s=1", adoptedAt: null, session: 1 }),
      undefined,
      undefined,
      { answers: new MachineAnswers() },
    );
    for (let read = 0; read < 2; read += 1) {
      const res = await proxy(asked(MODELS), { userId: "admin" });
      expect(res?.status).toBe(200);
      expect(await res!.text()).toBe(BODY);
    }
    expect(heard.map((h) => h.ifNoneMatch)).toEqual([undefined, undefined]);
  });
});

describe("the scope of a kept answer", () => {
  /**
   * A machine whose route sets a validator of its own and honours it on any request: were a kept
   * answer offered for the wrong reader, it would say 304 and that reader would be handed someone
   * else's body.
   */
  const heard: { path: string; ifNoneMatch?: string }[] = [];
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      heard.push({ path: req.url ?? "", ifNoneMatch: req.headers["if-none-match"] });
      res.setHeader("etag", '"v1"');
      if (req.headers["if-none-match"] === '"v1"') {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: req.url }));
    });
    port = await listening(server);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("is never offered for another user or another Project's read", async () => {
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port, cookie: "s=1", adoptedAt: null, session: 1 }),
      undefined,
      undefined,
      { answers: new MachineAnswers() },
    );
    const OTHER = "/api/projects/other_project/agents";
    await (await proxy(asked(AGENTS), { userId: "admin" }))?.arrayBuffer();
    await (await proxy(asked(AGENTS), { userId: "admin" }))?.arrayBuffer();
    const bob = await proxy(asked(AGENTS), { userId: "bob" });
    const other = await proxy(asked(OTHER), { userId: "admin" });

    expect(heard.map((h) => h.ifNoneMatch)).toEqual([undefined, '"v1"', undefined, undefined]);
    expect(await bob!.json()).toEqual({ path: AGENTS });
    expect(await other!.json()).toEqual({ path: OTHER });
  });
});

describe("the bound on kept answers", () => {
  it("keeps none too large, and lets the least recently used go first", () => {
    const answers = new MachineAnswers({ answerBytes: 10, totalBytes: 25 });
    const answer = (bytes: number) => ({
      etag: 'W/"x"',
      headers: [] as [string, string][],
      body: new Uint8Array(bytes),
    });
    answers.keep("a", answer(10));
    answers.keep("b", answer(10));
    answers.get("a");
    answers.keep("big", answer(11));
    answers.keep("c", answer(10));

    expect(answers.get("big")).toBeNull();
    expect(answers.get("b")).toBeNull();
    expect(answers.get("a")).not.toBeNull();
    expect(answers.get("c")).not.toBeNull();
  });
});
