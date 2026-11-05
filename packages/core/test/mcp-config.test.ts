/**
 * MCP server entries as Environment reads them from system_config.yaml.
 *
 * - Each transport resolves from its fields; an invalid entry, a duplicate name and a vault
 *   reference in the server's host — however the URL spells the host — are warnings that drop
 *   the entry, never the Agent.
 * - `${KEY}` in a header, `env` or `args` is filled in from the Agent's vault: the resolved
 *   server carries the value, while a key the vault lacks skips the server as needing setup,
 *   naming the key and never a value.
 * - An entry that declares OAuth sign-in and sends no Authorization header is skipped as needing
 *   a sign-in; a bearer header filled from the vault connects it.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  mcpSkipMessage,
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
    expect(resolveMCPServers([])).toEqual({ servers: [], skipped: [], warnings: [] });
  });
});

describe("resolveMCPServers — vault references and sign-in", () => {
  const secret = "s3cret-value-never-printed";

  it("fills ${KEY} in headers, env and args from the vault, and skips a server whose key is missing, naming only the key", () => {
    const entries = [
      {
        name: "remote",
        config: {
          url: "https://mcp.example.com/mcp?team=${TEAM}",
          headers: { Authorization: "Bearer ${API_TOKEN}" },
        },
      },
      {
        name: "local",
        config: {
          command: "srv",
          args: ["--token=${API_TOKEN}"],
          env: { API_TOKEN: "${API_TOKEN}", PLAIN: "as written" },
        },
      },
    ];
    const ready = resolveMCPServers(entries, { API_TOKEN: secret, TEAM: "blue" });
    expect(ready.skipped).toEqual([]);
    expect(ready.servers.map((s) => s.transport)).toEqual([
      {
        kind: "http",
        url: "https://mcp.example.com/mcp?team=blue",
        headers: { Authorization: `Bearer ${secret}` },
      },
      {
        kind: "stdio",
        command: "srv",
        args: [`--token=${secret}`],
        env: { API_TOKEN: secret, PLAIN: "as written" },
      },
    ]);

    const { servers, skipped, warnings } = resolveMCPServers(entries, { TEAM: "blue" });
    expect(servers).toEqual([]);
    expect(warnings).toEqual([]);
    expect(skipped).toEqual([
      { name: "remote", transport: "http", skip: { reason: "needs_setup", keys: ["API_TOKEN"] } },
      { name: "local", transport: "stdio", skip: { reason: "needs_setup", keys: ["API_TOKEN"] } },
    ]);
    expect(mcpSkipMessage(skipped[0]!.skip)).toBe("needs setup: vault key API_TOKEN is not set");
  });

  it("never reads a vault value into the server's address: a reference in the host is an invalid entry, however the URL spells it", () => {
    // Every spelling here is one the URL parser reads with `${HOST}` (or `${USER}`) in the
    // authority — without "//", with one slash, with backslashes, with a tab or a leading space
    // the parser drops, in the user info, glued to the host.
    for (const url of [
      "https://${HOST}/mcp",
      "https:${HOST}/mcp",
      "https:/${HOST}/mcp",
      "https:\\\\${HOST}/mcp",
      "https:/\t/${HOST}/mcp",
      " https://${HOST}/mcp",
      "https://${USER}@mcp.example.com/mcp",
      "https://mcp.example.com${HOST}/mcp",
    ]) {
      const { servers, skipped, warnings } = resolveMCPServers(
        [{ name: "moving", config: { url } }],
        { HOST: "elsewhere.example", USER: "someone" },
      );
      expect(servers, url).toEqual([]);
      expect(skipped, url).toEqual([]);
      expect(warnings, url).toEqual([
        'MCP server "moving" skipped: "url" cannot take a ${KEY} vault reference in its host',
      ]);
    }
    // A path or a query may still take one.
    const fixed = resolveMCPServers(
      [{ name: "fixed", config: { url: "https://mcp.example.com/${TEAM}/mcp?team=${TEAM}" } }],
      { TEAM: "blue" },
    );
    expect(fixed.servers.map((s) => s.transport)).toEqual([
      { kind: "http", url: "https://mcp.example.com/blue/mcp?team=blue" },
    ]);
  });

  it("skips an entry that declares OAuth sign-in without an Authorization header, and connects it once a bearer header is filled in", () => {
    const oauth = { scopes: ["mail.read"], client_id: "${CLIENT_ID}" };
    const signIn = resolveMCPServers(
      [{ name: "mail", config: { url: "https://mail.example.com/mcp", oauth } }],
      { CLIENT_ID: "id" },
    );
    expect(signIn.servers).toEqual([]);
    expect(signIn.skipped).toEqual([
      { name: "mail", transport: "http", skip: { reason: "sign_in_required" } },
    ]);
    expect(mcpSkipMessage(signIn.skipped[0]!.skip)).toMatch(/OAuth sign-in/);

    const token = resolveMCPServers(
      [
        {
          name: "mail",
          config: {
            url: "https://mail.example.com/mcp",
            oauth,
            headers: { authorization: "Bearer ${MAIL_TOKEN}" },
          },
        },
      ],
      { CLIENT_ID: "id", MAIL_TOKEN: secret },
    );
    expect(token.skipped).toEqual([]);
    expect(token.servers[0]!.transport).toMatchObject({
      headers: { authorization: `Bearer ${secret}` },
    });
  });
});
