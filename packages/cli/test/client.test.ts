/**
 * Server-client plumbing: connection resolution order (--server > PENGUIN_API_URL >
 * live server.lock > auto-start), the remote-token gate, the SSE parser, and session
 * reference resolution (full id / unique fragment / ambiguity), and where the credential
 * comes from.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "../src/client.js";
import { getMessages } from "../src/i18n.js";
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

describe("credential resolution", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-cred-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const conn = (baseUrl: string) => ({ baseUrl, root, autoStarted: false, loopback: true });
  const storeLogin = (server: string) =>
    fs.writeFileSync(
      path.join(root, "cli-session.json"),
      JSON.stringify({ server, userId: "admin", token: "signed-in" }),
    );

  const writeTokenFile = (value: string) => fs.writeFileSync(path.join(root, "api-token"), value);

  it("outside a Session: PENGUIN_API_TOKEN, then the stored sign-in, then the api-token file", () => {
    writeTokenFile("boot-token\n");
    expect(new ServerClient(conn("http://localhost:7364"), t).tokenSource).toBe("file");
    storeLogin("http://localhost:7364");
    expect(new ServerClient(conn("http://localhost:7364"), t).tokenSource).toBe("login");
    process.env.PENGUIN_API_TOKEN = "from-env";
    expect(new ServerClient(conn("http://localhost:7364"), t).tokenSource).toBe("env");
  });

  it("the api-token file is never read for a remote target", () => {
    writeTokenFile("boot-token\n");
    const remote = { ...conn("https://remote.example"), loopback: false };
    expect(new ServerClient(remote, t).tokenSource).toBe("none");
  });

  it("a 401 with the file's token re-reads the file once and retries (the server restarted)", async () => {
    writeTokenFile("old-boot\n");
    const client = new ServerClient(conn("http://localhost:7364"), t);
    const seen: Array<string | undefined> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).authorization;
      seen.push(auth);
      return auth === "Bearer new-boot"
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response("{}", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      writeTokenFile("new-boot\n");
      await expect(client.request("GET", "/api/me")).resolves.toEqual({ ok: true });
      expect(seen).toEqual(["Bearer old-boot", "Bearer new-boot"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("outside a Session the sign-in stored on the data root is used, for loopback targets only", () => {
    storeLogin("http://localhost:7364");
    // An auto-started server on another port serves the same root: the sign-in holds there too.
    expect(new ServerClient(conn("http://localhost:41234"), t).tokenSource).toBe("login");
    const remote = { ...conn("https://remote.example"), loopback: false };
    expect(new ServerClient(remote, t).tokenSource).toBe("none");
  });

  it("inside a Session only the environment's credential counts", () => {
    storeLogin("http://localhost:7364");
    writeTokenFile("boot-token\n");
    process.env.PENGUIN_SESSION_ID = "session-2026-09-30-00-00-00-00000000";
    expect(new ServerClient(conn("http://localhost:7364"), t).tokenSource).toBe("none");
    process.env.PENGUIN_API_TOKEN = "pst1.claims.mac";
    expect(new ServerClient(conn("http://localhost:7364"), t).tokenSource).toBe("env");
  });
});
