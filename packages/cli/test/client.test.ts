/**
 * Server-client plumbing: connection resolution order (--server > PENGUIN_API_URL >
 * live server.lock > auto-start), the remote-token gate, the SSE parser, and session
 * reference resolution (full id / unique fragment / ambiguity).
 *
 * - Given a plugin command the server refuses for the token outside a Session (403
 *   `session_required`), the client never sends the person's stored sign-in instead: an Agent can
 *   unset PENGUIN_SESSION_ID, so the refusal stands everywhere.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  autoStartEntry,
  connectionLabel,
  normalizeServerUrl,
  parseSseBody,
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  resolveSessionRef,
  ServerClient,
  shortSessionId,
  getMessages,
  writeSession,
} from "@prismshadow/penguin-server/cli";

import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

const ENV_KEYS = [
  "PENGUIN_API_URL",
  "PENGUIN_API_TOKEN",
  "PENGUIN_HOME",
  "PENGUIN_PROJECT_ID",
  "PENGUIN_AGENT_ID",
  "PENGUIN_SESSION_ID",
];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("connection resolution", () => {
  it("--server wins over PENGUIN_API_URL; trailing slashes are stripped", async () => {
    process.env.PENGUIN_API_URL = "http://127.0.0.1:7001";
    const conn = await resolveConnection({ server: "http://localhost:7002/" }, t);
    expect(conn.baseUrl).toBe("http://localhost:7002");
    expect(conn.loopback).toBe(true);
    expect(conn.autoStarted).toBe(false);
    // A named server is labelled by its URL alone: no data root stands behind the choice.
    expect(connectionLabel(conn)).toBe("http://localhost:7002");
  });

  it("PENGUIN_API_URL is used when --server is absent", async () => {
    process.env.PENGUIN_API_URL = "http://127.0.0.1:7001";
    const conn = await resolveConnection({}, t);
    expect(conn.baseUrl).toBe("http://127.0.0.1:7001");
  });

  it("a remote URL without PENGUIN_API_TOKEN is refused with the token hint", async () => {
    await expect(resolveConnection({ server: "https://box.example.com" }, t)).rejects.toThrow(
      /PENGUIN_API_TOKEN/,
    );
    process.env.PENGUIN_API_TOKEN = "remote-token";
    const conn = await resolveConnection({ server: "https://box.example.com" }, t);
    expect(conn.baseUrl).toBe("https://box.example.com");
    expect(conn.loopback).toBe(false);
  });

  it("junk URLs are rejected with a localized message", () => {
    expect(() => normalizeServerUrl("not a url", t)).toThrow(/Invalid server URL/);
    expect(() => normalizeServerUrl("ftp://x", t)).toThrow(/Invalid server URL/);
  });

  it("a live server.lock on the data root resolves to http://localhost:<port>", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-lock-"));
    process.env.PENGUIN_HOME = root;
    // Liveness needs a real pid AND an accepting port: use this process and a real listener.
    const listener = net.createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as net.AddressInfo).port;
    fs.writeFileSync(
      path.join(root, "server.lock"),
      `${JSON.stringify({ pid: process.pid, port, startedAt: "now" })}\n`,
    );
    try {
      const conn = await resolveConnection({}, t);
      expect(conn.baseUrl).toBe(`http://localhost:${port}`);
      expect(conn.autoStarted).toBe(false);
      // Found through the root, so the banner names the root: that tells two local
      // instances apart where the port alone would not.
      expect(connectionLabel(conn)).toBe(`http://localhost:${port} (${root})`);
    } finally {
      listener.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("no server + autoStart disabled -> the no-server error; a stale lock does not count", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-stale-"));
    process.env.PENGUIN_HOME = root;
    // A lock whose port nothing accepts is stale and must be ignored.
    fs.writeFileSync(
      path.join(root, "server.lock"),
      `${JSON.stringify({ pid: process.pid, port: 1, startedAt: "now" })}\n`,
    );
    try {
      await expect(resolveConnection({ autoStart: false }, t)).rejects.toThrow(t.client.noServer());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("autoStartEntry accepts plain-node entries only (a tsx .ts dev entry cannot re-run)", () => {
    expect(autoStartEntry("/x/dist/penguin.js")).toBe(path.resolve("/x/dist/penguin.js"));
    expect(autoStartEntry("/x/dist/penguin.mjs")).not.toBeNull();
    expect(autoStartEntry("/x/src/penguin.ts")).toBeNull();
    expect(autoStartEntry(undefined)).toBeNull();
  });
});

describe("SSE parsing", () => {
  async function frames(text: string) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const out = [];
    for await (const frame of parseSseBody(body)) out.push(frame);
    return out;
  }

  it("parses id/event/data frames, ignores heartbeat comments, tolerates CRLF", async () => {
    const out = await frames(
      ': ping\r\n\r\nid: 7-1\nevent: server_event\ndata: {"type":"hello"}\n\n' +
        'id: 7-2\ndata: {"a":1}\r\n\r\n',
    );
    expect(out).toEqual([
      { id: "7-1", event: "server_event", data: '{"type":"hello"}' },
      { id: "7-2", data: '{"a":1}' },
    ]);
  });

  it("joins multi-line data with newlines and handles chunk splits mid-line", async () => {
    const text = "data: line1\ndata: line2\n\n";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(text.slice(0, 9)));
        controller.enqueue(enc.encode(text.slice(9)));
        controller.close();
      },
    });
    const out = [];
    for await (const frame of parseSseBody(body)) out.push(frame);
    expect(out).toEqual([{ data: "line1\nline2" }]);
  });
});

describe("session references", () => {
  it("shortSessionId is the 8-hex tail", () => {
    expect(shortSessionId("session-2026-08-25-10-00-00-00c0ffee")).toBe("00c0ffee");
    expect(shortSessionId("weird")).toBe("weird");
  });

  it("full id passes through; a unique fragment resolves; ambiguity lists candidates; misses error", async () => {
    const server = new FakeServer();
    const restore = server.install();
    try {
      const a = server.addSession({ sessionId: "session-2026-08-25-10-00-00-aaaa1111" });
      server.addSession({ sessionId: "session-2026-08-25-11-00-00-bbbb1111" });
      const client = new ServerClient(await resolveConnection({}, t), t);
      await expect(resolveSessionRef(client, "default_project", a.sessionId, t)).resolves.toBe(
        a.sessionId,
      );
      await expect(resolveSessionRef(client, "default_project", "aaaa1111", t)).resolves.toBe(
        a.sessionId,
      );
      await expect(resolveSessionRef(client, "default_project", "1111", t)).rejects.toThrow(
        /matches 2 sessions/,
      );
      await expect(resolveSessionRef(client, "default_project", "nope", t)).rejects.toThrow(
        /No session matching/,
      );
    } finally {
      restore();
    }
  });
});

describe("option defaults", () => {
  it("project/agent ids: flag > env > built-in default", () => {
    expect(resolveProjectId(undefined)).toBe("default_project");
    expect(resolveAgentId(undefined)).toBe("default_agent");
    process.env.PENGUIN_PROJECT_ID = "env-project";
    process.env.PENGUIN_AGENT_ID = "env-agent";
    expect(resolveProjectId(undefined)).toBe("env-project");
    expect(resolveAgentId(undefined)).toBe("env-agent");
    expect(resolveProjectId("flag-project")).toBe("flag-project");
    expect(resolveAgentId("flag-agent")).toBe("flag-agent");
  });
});

describe("a plugin command that runs for a Session's driver, called outside a Session", () => {
  const realFetch = globalThis.fetch;
  let root: string;
  let sent: Array<Record<string, string>>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-client-"));
    process.env.PENGUIN_API_TOKEN = "boot-token";
    writeSession(root, { server: "http://localhost:7399", userId: "mia", token: "login-mia" });
    sent = [];
    // The server: the token is refused; a person's sign-in would run the command.
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push(headers);
      return headers.authorization !== undefined
        ? new Response(JSON.stringify({ error: { code: "session_required", message: "x" } }), {
            status: 403,
          })
        : new Response(JSON.stringify({ exitCode: 0, stdout: "ran\n", stderr: "" }), {
            status: 200,
          });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("never sends the stored sign-in in the token's place: the refusal stands", async () => {
    const client = new ServerClient(
      {
        baseUrl: "http://localhost:7399",
        root,
        autoStarted: false,
        loopback: true,
        fromRoot: true,
      },
      t,
    );
    await expect(client.request("POST", "/api/cli/commands/run", {})).rejects.toMatchObject({
      status: 403,
      code: "session_required",
    });
    expect(sent.map((h) => h.authorization ?? h.cookie)).toEqual(["Bearer boot-token"]);
  });

  it("never switches from an env-sourced PENGUIN_API_TOKEN to the person's stored sign-in on 403 human_required", async () => {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push(headers);
      return headers.authorization !== undefined
        ? new Response(
            JSON.stringify({ error: { code: "human_required", message: "human only" } }),
            {
              status: 403,
            },
          )
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const client = new ServerClient(
      {
        baseUrl: "http://localhost:7399",
        root,
        autoStarted: false,
        loopback: true,
        fromRoot: true,
      },
      t,
    );
    await expect(client.request("PUT", "/api/admin/settings", {})).rejects.toMatchObject({
      status: 403,
      code: "human_required",
    });
    expect(sent.map((h) => h.authorization ?? h.cookie)).toEqual(["Bearer boot-token"]);
  });

  it("pairs explicit --root with that root's api-token file instead of an ambient PENGUIN_API_TOKEN", async () => {
    const explicitRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-explicit-root-"));
    const listener = net.createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as net.AddressInfo).port;
    fs.writeFileSync(
      path.join(explicitRootDir, "server.lock"),
      `${JSON.stringify({ pid: process.pid, port, startedAt: "now" })}\n`,
    );
    fs.writeFileSync(path.join(explicitRootDir, "api-token"), "explicit-root-token\n");
    process.env.PENGUIN_API_URL = "http://127.0.0.1:7001";
    process.env.PENGUIN_API_TOKEN = "ambient-env-token";

    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      sent.push(headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const conn = await resolveConnection({ root: explicitRootDir }, t);
      expect(conn.baseUrl).toBe(`http://localhost:${port}`);
      expect(conn.explicitRoot).toBe(true);
      const client = new ServerClient(conn, t);
      await client.request("GET", "/api/projects");
      expect(sent.map((h) => h.authorization)).toEqual(["Bearer explicit-root-token"]);

      sent.length = 0;
      const connWithLoopbackServer = await resolveConnection(
        { root: explicitRootDir, server: `http://127.0.0.1:${port}` },
        t,
      );
      expect(connWithLoopbackServer.explicitRoot).toBe(true);
      const clientWithLoopbackServer = new ServerClient(connWithLoopbackServer, t);
      await clientWithLoopbackServer.request("GET", "/api/projects");
      expect(sent.map((h) => h.authorization)).toEqual(["Bearer explicit-root-token"]);
    } finally {
      listener.close();
      fs.rmSync(explicitRootDir, { recursive: true, force: true });
    }
  });
});
