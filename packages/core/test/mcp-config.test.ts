import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  resolveMCPServer,
  resolveMCPServers,
} from "../src/environment/mcp/config.js";

describe("resolveMCPServer — transports", () => {
  it("resolves an explicit stdio entry with all fields", () => {
    const resolved = resolveMCPServer({
      name: "fs",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        env: { A: "1" },
        cwd: "/srv",
      },
    });
    expect(resolved.transport).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: { A: "1" },
      cwd: "/srv",
    });
    expect(resolved.connectTimeoutMs).toBe(DEFAULT_MCP_CONNECT_TIMEOUT_MS);
  });

  it("infers stdio from command and http from url", () => {
    expect(resolveMCPServer({ name: "a", config: { command: "srv" } }).transport.kind).toBe(
      "stdio",
    );
    expect(
      resolveMCPServer({ name: "b", config: { url: "https://example.com/mcp" } }).transport.kind,
    ).toBe("http");
  });

  it("keeps sse explicit and carries url + headers", () => {
    const resolved = resolveMCPServer({
      name: "legacy",
      config: { transport: "sse", url: "https://example.com/sse", headers: { "x-k": "v" } },
    });
    expect(resolved.transport).toEqual({
      kind: "sse",
      url: "https://example.com/sse",
      headers: { "x-k": "v" },
    });
  });

  it('carries an explicit permission and treats "auto" (and absence) as unset', () => {
    expect(
      resolveMCPServer({ name: "a", config: { command: "x", permission: "r" } }).permission,
    ).toBe("r");
    expect(
      resolveMCPServer({ name: "a", config: { command: "x", permission: "rw" } }).permission,
    ).toBe("rw");
    expect(
      resolveMCPServer({ name: "a", config: { command: "x", permission: "auto" } }).permission,
    ).toBeUndefined();
    expect(resolveMCPServer({ name: "a", config: { command: "x" } }).permission).toBeUndefined();
  });

  it("passes through per-server budgets, flooring fractions", () => {
    const resolved = resolveMCPServer({
      name: "t",
      config: { command: "srv", connectTimeoutMs: 2500.9, timeoutMs: 1000, maxOutputLength: 50 },
    });
    expect(resolved.connectTimeoutMs).toBe(2500);
    expect(resolved.timeoutMs).toBe(1000);
    expect(resolved.maxOutputLength).toBe(50);
  });

  it.each([
    ["bad name", { name: "no spaces", config: { command: "x" } }, /invalid server name/],
    ["empty name", { name: "", config: { command: "x" } }, /invalid server name/],
    ["config not object", { name: "a", config: null as never }, /"config" must be an object/],
    ["unknown transport", { name: "a", config: { transport: "ws" } }, /unknown transport/],
    ["nothing to infer", { name: "a", config: {} }, /cannot infer transport/],
    ["stdio no command", { name: "a", config: { transport: "stdio" } }, /requires a non-empty/],
    ["empty command", { name: "a", config: { command: "  " } }, /requires a non-empty/],
    [
      "args not strings",
      { name: "a", config: { command: "x", args: [1] } },
      /"args" must be an array of strings/,
    ],
    [
      "env not string map",
      { name: "a", config: { command: "x", env: { k: 1 } } },
      /"env" must be a map/,
    ],
    ["http no url", { name: "a", config: { transport: "http" } }, /requires a "url"/],
    ["bad url", { name: "a", config: { url: "not a url" } }, /not a valid URL/],
    ["non-http scheme", { name: "a", config: { url: "ftp://x/y" } }, /must use http/],
    [
      "headers not string map",
      { name: "a", config: { url: "https://x", headers: { k: 2 } } },
      /"headers" must be a map/,
    ],
    [
      "non-positive connect timeout",
      { name: "a", config: { command: "x", connectTimeoutMs: 0 } },
      /"connectTimeoutMs"/,
    ],
    ["negative timeoutMs", { name: "a", config: { command: "x", timeoutMs: -5 } }, /"timeoutMs"/],
    [
      "unknown permission",
      { name: "a", config: { command: "x", permission: "read-only" } },
      /"permission" must be "auto", "r" or "rw"/,
    ],
    [
      "non-string permission",
      { name: "a", config: { command: "x", permission: true } },
      /"permission" must be "auto", "r" or "rw"/,
    ],
  ])("rejects %s", (_label, entry, pattern) => {
    expect(() => resolveMCPServer(entry as never)).toThrow(pattern);
  });
});

describe("resolveMCPServers — list semantics", () => {
  it("skips invalid entries and duplicates with warnings, keeping order", () => {
    const { servers, warnings } = resolveMCPServers([
      { name: "one", config: { command: "a" } },
      { name: "bad entry", config: { command: "b" } },
      { name: "two", config: { url: "https://x/mcp" } },
      { name: "one", config: { command: "c" } },
    ]);
    expect(servers.map((s) => s.name)).toEqual(["one", "two"]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/"bad entry" skipped: invalid server name/);
    expect(warnings[1]).toMatch(/"one" skipped: duplicate server name/);
  });

  it("skips an entry with an invalid permission, keeping the valid ones", () => {
    const { servers, warnings } = resolveMCPServers([
      { name: "ok", config: { command: "a", permission: "r" } },
      { name: "typo", config: { command: "b", permission: "readonly" } },
    ]);
    expect(servers.map((s) => s.name)).toEqual(["ok"]);
    expect(servers[0]!.permission).toBe("r");
    expect(warnings).toEqual([
      'MCP server "typo" skipped: "permission" must be "auto", "r" or "rw"',
    ]);
  });

  it("returns empty results for an empty list", () => {
    expect(resolveMCPServers([])).toEqual({ servers: [], warnings: [] });
  });
});
