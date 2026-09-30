/**
 * `penguin telemetry` against the fake server: the per-probe summary by default, the session
 * and sample views, the switch and clear subcommands, and the one rule the command itself
 * owns — inside a session (PENGUIN_SESSION_ID) it asks for that session's samples unless
 * `--session` or `--all` says otherwise. What the server does with the query is its own
 * suite's (packages/server/test/telemetry.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");
const SESSION = "session-2026-09-30-08-00-00-aaaa0001";

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
let priorLang: string | undefined;

beforeEach(() => {
  priorLang = process.env.PENGUIN_LANG;
  process.env.PENGUIN_LANG = "en";
  server = new FakeServer();
  uninstall = server.install();
  server.telemetry = {
    enabled: true,
    probes: [
      { probe: "http.request", count: 3, p50Ms: 4.2, p95Ms: 18, maxMs: 18, bytes: 2048 },
      { probe: "boot.module", count: 40, p50Ms: 0.4, p95Ms: 12.5, maxMs: 30.1, bytes: null },
    ],
    sessions: [
      {
        session: SESSION,
        count: 2,
        lastTs: 1,
        probes: [
          { probe: "session.messages", count: 1, totalMs: 42, maxMs: 42 },
          { probe: "trace.read", count: 1, totalMs: 30, maxMs: 30 },
        ],
      },
    ],
    samples: [
      {
        ts: Date.UTC(2026, 8, 30, 8, 0, 0),
        probe: "session.messages",
        durMs: 42,
        bytes: 5120,
        n: 12,
        status: "ok",
        keys: { session: SESSION, request: "0123456789abcdef", generation: 1 },
        attrs: { kind: "tail", shards: 1 },
      },
    ],
  };
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  uninstall();
  if (priorLang === undefined) delete process.env.PENGUIN_LANG;
  else process.env.PENGUIN_LANG = priorLang;
});

const out = () => stdout.join("");
const lastQuery = () => {
  const req = server.requests.filter((r) => r.path === "/api/telemetry").at(-1)!;
  return new URLSearchParams(req.search);
};

describe("penguin telemetry", () => {
  it("prints the per-probe summary by default", async () => {
    expect(await cli(["telemetry"])).toBe(0);
    expect(lastQuery().get("view")).toBe("probes");
    expect(lastQuery().has("session")).toBe(false);
    expect(out()).toContain("http.request");
    expect(out()).toContain("18ms");
    expect(out()).toContain("2.0KB");
    expect(out()).toContain("boot.module");
  });

  it("prints the session view and the samples", async () => {
    expect(await cli(["telemetry", "--by", "session"])).toBe(0);
    expect(lastQuery().get("view")).toBe("sessions");
    expect(out()).toContain(SESSION);
    expect(out()).toContain("trace.read");

    stdout.length = 0;
    expect(await cli(["telemetry", "--samples", "--probe", "session.messages"])).toBe(0);
    expect(lastQuery().get("view")).toBe("samples");
    expect(lastQuery().get("probe")).toBe("session.messages");
    expect(out()).toContain("kind=tail");
    expect(out()).toContain("n=12");
    expect(out()).toContain("req=01234567");
  });

  it("inside a session asks for that session only, unless --all or --session says otherwise", async () => {
    process.env.PENGUIN_SESSION_ID = SESSION;
    expect(await cli(["telemetry", "--samples"])).toBe(0);
    expect(lastQuery().get("session")).toBe(SESSION);
    expect(out()).toContain(t.telemetry.scopedTo(SESSION));

    expect(await cli(["telemetry", "--all"])).toBe(0);
    expect(lastQuery().has("session")).toBe(false);

    expect(await cli(["telemetry", "--session", "session-other"])).toBe(0);
    expect(lastQuery().get("session")).toBe("session-other");
  });

  it("says so when the switch is off, and flips it with on/off", async () => {
    server.telemetry.enabled = false;
    expect(await cli(["telemetry"])).toBe(0);
    expect(out()).toContain(t.telemetry.off());

    stdout.length = 0;
    expect(await cli(["telemetry", "on"])).toBe(0);
    expect(out()).toContain(t.telemetry.turnedOn());
    const put = server.requests.filter((r) => r.path === "/api/admin/settings").at(-1)!;
    expect(put.method).toBe("PUT");
    expect(put.body).toEqual({ telemetry: true });

    expect(await cli(["telemetry", "off"])).toBe(0);
    expect(out()).toContain(t.telemetry.turnedOff());
    expect(server.telemetry.enabled).toBe(false);
  });

  it("clears the buffer", async () => {
    expect(await cli(["telemetry", "clear"])).toBe(0);
    expect(server.requests.at(-1)!.method).toBe("DELETE");
    expect(out()).toContain(t.telemetry.cleared());
  });

  it("refuses a bad --by and a bad --limit", async () => {
    expect(await cli(["telemetry", "--by", "module"])).toBe(1);
    expect(stderr.join("")).toContain(t.telemetry.byInvalid("module"));
    expect(await cli(["telemetry", "--samples", "--limit", "0"])).toBe(1);
    expect(stderr.join("")).toContain(t.telemetry.limitInvalid("0"));
  });
});
