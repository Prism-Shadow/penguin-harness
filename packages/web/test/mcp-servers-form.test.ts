import { describe, expect, it } from "vitest";
import {
  emptyMcpForm,
  formToServer,
  parseKeyValueLines,
  serverToForm,
} from "../src/features/agents/mcp-servers-form";

describe("serverToForm", () => {
  it("loads a stdio entry, inferring the transport from command", () => {
    const form = serverToForm({
      name: "fs",
      config: {
        command: "npx",
        args: ["-y", "pkg"],
        env: { A: "1", B: "2" },
        cwd: "/srv",
        timeoutMs: 500,
      },
    });
    expect(form.transport).toBe("stdio");
    expect(form.command).toBe("npx");
    expect(form.argsText).toBe("-y\npkg");
    expect(form.envText).toBe("A=1\nB=2");
    expect(form.cwd).toBe("/srv");
    expect(form.timeoutMs).toBe("500");
    expect(form.extras).toEqual({});
  });

  it("loads an http entry and keeps unknown config keys as extras", () => {
    const form = serverToForm({
      name: "web",
      config: { url: "https://x/mcp", headers: { "x-k": "v" }, futureKey: { nested: true } },
    });
    expect(form.transport).toBe("http");
    expect(form.url).toBe("https://x/mcp");
    expect(form.headersText).toBe("x-k: v");
    expect(form.extras).toEqual({ futureKey: { nested: true } });
  });
});

describe("formToServer", () => {
  it("builds a stdio entry and round-trips through serverToForm", () => {
    const server = {
      name: "fs",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { A: "1" },
        cwd: "/srv",
        connectTimeoutMs: 2000,
      },
    };
    const built = formToServer(serverToForm(server));
    expect(built).toEqual({ ok: true, server });
  });

  it("defaults new entries to http", () => {
    expect(emptyMcpForm().transport).toBe("http");
  });

  it("merges extras back and lets known fields win", () => {
    const form = {
      ...emptyMcpForm(),
      transport: "stdio" as const,
      name: "a",
      command: "x",
      extras: { custom: 1, command: "stale" },
    };
    const built = formToServer(form);
    expect(built).toEqual({
      ok: true,
      server: { name: "a", config: { custom: 1, transport: "stdio", command: "x" } },
    });
  });

  it("requires url for http and validates the scheme", () => {
    const missing = formToServer({ ...emptyMcpForm(), name: "a", transport: "http" });
    expect(missing).toMatchObject({ ok: false, errors: { url: { code: "required" } } });
    const bad = formToServer({ ...emptyMcpForm(), name: "a", transport: "http", url: "ftp://x" });
    expect(bad).toMatchObject({ ok: false, errors: { url: { code: "url_invalid" } } });
  });

  it("collects name, command and budget errors", () => {
    const built = formToServer({
      ...emptyMcpForm(),
      transport: "stdio",
      name: "no spaces",
      timeoutMs: "-3",
    });
    expect(built).toMatchObject({
      ok: false,
      errors: {
        name: { code: "name_charset" },
        command: { code: "required" },
        timeoutMs: { code: "number" },
      },
    });
  });

  it("reports the offending env line", () => {
    const built = formToServer({
      ...emptyMcpForm(),
      transport: "stdio",
      name: "a",
      command: "x",
      envText: "GOOD=1\nbroken-line",
    });
    expect(built).toMatchObject({ ok: false, errors: { env: { code: "kv_line", line: 2 } } });
  });
});

describe("parseKeyValueLines", () => {
  it("parses, trims and skips blank lines", () => {
    expect(parseKeyValueLines(" A=1 \n\nB = 2 ", "=")).toEqual({
      ok: true,
      map: { A: "1", B: "2" },
    });
    expect(parseKeyValueLines("X-Header: a: b", ":")).toEqual({
      ok: true,
      map: { "X-Header": "a: b" },
    });
  });

  it("rejects lines without a separator or key", () => {
    expect(parseKeyValueLines("A=1\nnope", "=")).toEqual({ ok: false, line: 2 });
    expect(parseKeyValueLines("=v", "=")).toEqual({ ok: false, line: 1 });
  });
});
