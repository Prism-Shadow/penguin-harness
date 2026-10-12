import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import { Environment } from "../src/environment/index.js";
import { rmEventually } from "./rm-eventually.js";
import { McpToolProvider, renderCallToolResult } from "../src/environment/mcp/provider.js";
import { Session } from "../src/session.js";
import {
  assistantText,
  mcpConnectBegin,
  mcpConnectEnd,
  toolCall,
  toolListReady,
  userText,
} from "../src/omnimessage/index.js";
import { mcpConnectOutcome } from "../src/internal/session-support.js";
import type { OmniMessage, SessionMetaPayload } from "../src/omnimessage/index.js";
import type { LLMInterface, LLMOutcome, MCPServerConfig } from "../src/interfaces/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));

/** A `tools.mcpServers` entry spawning the stdio fixture, with optional extra config fields. */
function fixtureEntry(extra: Record<string, unknown> = {}): MCPServerConfig {
  return { name: "fx", config: { command: process.execPath, args: [FIXTURE], ...extra } };
}

async function collect(gen: AsyncGenerator<OmniMessage>): Promise<OmniMessage[]> {
  const out: OmniMessage[] = [];
  for await (const msg of gen) out.push(msg);
  return out;
}

interface FinalPayload {
  type?: string;
  output?: string;
  stop_reason?: string;
  images?: string[];
}

function finalPayload(messages: OmniMessage[]): FinalPayload {
  return messages[messages.length - 1]!.payload as FinalPayload;
}

/** Joins the streamed content deltas (to compare against the complete message). */
function streamedText(messages: OmniMessage[]): string {
  return messages
    .map((m) => m.payload as { type?: string; event_type?: string; output?: string })
    .filter((p) => p.type === "partial_tool_call_output" && p.event_type === "delta")
    .map((p) => p.output ?? "")
    .join("");
}

function runTool(
  env: Environment,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OmniMessage[]> {
  const call = toolCall({ name, arguments: JSON.stringify(args), toolCallId: "mcp-call-1" });
  return collect(env.executeTool({ toolCall: call, ...(signal ? { signal } : {}) }));
}

describe("renderCallToolResult", () => {
  it("maps the block types and falls back to structuredContent only when there is no text", () => {
    expect(
      renderCallToolResult({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
          { type: "audio", data: "BBBB", mimeType: "audio/wav" },
          { type: "resource_link", uri: "file:///x", name: "x", description: "a file" },
          { type: "resource", resource: { uri: "mem://t", text: "embedded" } },
          { type: "resource", resource: { uri: "mem://b", blob: "CCCC" } },
        ],
        structuredContent: { ignored: true },
      }),
    ).toEqual({
      text: [
        "hello",
        "[audio content: audio/wav]",
        "[resource: file:///x] a file",
        "embedded",
        "[resource: mem://b (binary)]",
      ].join("\n"),
      images: ["data:image/png;base64,AAAA"],
    });

    expect(renderCallToolResult({ content: [], structuredContent: { a: 1 } })).toEqual({
      text: JSON.stringify({ a: 1 }, null, 2),
      images: [],
    });
  });
});

describe("Environment.reconfigure with MCP Servers (a new model context's server list)", () => {
  let dir: string;
  let env: Environment;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-reconf-")));
    env = new Environment({
      workspaceDir: dir,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()] },
    });
  });

  afterAll(async () => {
    env.dispose();
    await rmEventually(dir);
  }, 30_000);

  it("closes the previous context's servers and connects the new list on the next listTools", async () => {
    expect((await env.listTools()).map((t) => t.name)).toContain("mcp__fx__echo");
    expect(env.pendingMcpServerNames()).toEqual([]);

    // A context without servers: nothing listed, the old tool names no longer resolve.
    env.reconfigure({ toolConfig: { customTools: [], mcpServers: [] }, vault: {} });
    expect(env.pendingMcpServerNames()).toEqual([]);
    expect(env.mcpConnectResults()).toEqual([]);
    expect(await env.listTools()).toEqual([]);
    const gone = finalPayload(await runTool(env, "mcp__fx__echo", { text: "x" }));
    expect(gone.stop_reason).toBe("fatal");
    expect(gone.output).toContain("Unknown tool: mcp__fx__echo");

    // A context with the server under a new name: connected afresh, lazily, on listTools —
    // the tools come back under the new prefix and execute.
    env.reconfigure({
      toolConfig: { customTools: [], mcpServers: [{ ...fixtureEntry(), name: "fx2" }] },
      vault: {},
    });
    expect(env.pendingMcpServerNames()).toEqual(["fx2"]);
    expect(env.mcpConnectResults()).toEqual([]);
    expect((await env.listTools()).map((t) => t.name)).toContain("mcp__fx2__echo");
    expect(env.mcpConnectResults()).toEqual([
      expect.objectContaining({ server: "fx2", status: "completed" }),
    ]);
    const echoed = finalPayload(await runTool(env, "mcp__fx2__echo", { text: "hi" }));
    expect(echoed.stop_reason).toBe("completed");
    expect(echoed.output).toBe("echo: hi");

    // The same entry again — a Session compacting every turn must not respawn its servers:
    // nothing is pending, the next listTools runs no connect phase (no outcome to report),
    // and the connection keeps serving.
    env.reconfigure({
      toolConfig: { customTools: [], mcpServers: [{ ...fixtureEntry(), name: "fx2" }] },
      vault: {},
    });
    expect(env.pendingMcpServerNames()).toEqual([]);
    expect((await env.listTools()).map((t) => t.name)).toContain("mcp__fx2__echo");
    expect(env.mcpConnectResults()).toEqual([]);
    const again = finalPayload(await runTool(env, "mcp__fx2__echo", { text: "kept" }));
    expect(again.output).toBe("echo: kept");

    // A changed entry (a new env var for the server) is a different server: reconnected.
    env.reconfigure({
      toolConfig: {
        customTools: [],
        mcpServers: [{ ...fixtureEntry({ env: { FIXTURE_SECRET: "v2" } }), name: "fx2" }],
      },
      vault: {},
    });
    expect(env.pendingMcpServerNames()).toEqual(["fx2"]);
    await env.listTools();
    expect(env.mcpConnectResults()).toEqual([
      expect.objectContaining({ server: "fx2", status: "completed" }),
    ]);
    expect(finalPayload(await runTool(env, "mcp__fx2__probe", {})).output).toMatch(/^v2\|/);
  }, 30_000);
});

describe("MCP servers whose entry references the Agent's vault", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-vault-")));
  });

  afterAll(async () => {
    await rmEventually(dir);
  }, 30_000);

  it("reports a server whose vault key is missing without contacting it, and connects it with the value once the vault has the key", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const toolConfig = {
      customTools: [],
      mcpServers: [fixtureEntry({ env: { FIXTURE_SECRET: "${FIXTURE_SECRET}" } })],
    };
    const env = new Environment({ workspaceDir: dir, toolConfig });
    try {
      // Needs setup: reported like a failed server, with no time spent on it.
      expect(env.pendingMcpServerNames()).toEqual(["fx"]);
      expect(await env.listTools()).toEqual([]);
      expect(env.mcpConnectResults()).toEqual([
        {
          server: "fx",
          transport: "stdio",
          status: "fatal",
          duration_ms: 0,
          error_code: "mcp_needs_setup",
          error_message: "needs setup: vault key FIXTURE_SECRET is not set",
        },
      ]);
      const printed = () => stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(printed()).toContain(
        'MCP server "fx" skipped: needs setup: vault key FIXTURE_SECRET is not set',
      );

      // The next context has the key: the server connects, and its process gets the value.
      env.reconfigure({ toolConfig, vault: { FIXTURE_SECRET: "first-value" } });
      expect(env.pendingMcpServerNames()).toEqual(["fx"]);
      let probe = finalPayload(await runTool(env, "mcp__fx__probe", {}));
      expect(probe.output).toMatch(/^first-value\|/);

      // Same value: the connection is kept. A changed value is a changed server: it reconnects.
      env.reconfigure({ toolConfig, vault: { FIXTURE_SECRET: "first-value" } });
      expect(env.pendingMcpServerNames()).toEqual([]);
      env.reconfigure({ toolConfig, vault: { FIXTURE_SECRET: "second-value" } });
      expect(env.pendingMcpServerNames()).toEqual(["fx"]);
      probe = finalPayload(await runTool(env, "mcp__fx__probe", {}));
      expect(probe.output).toMatch(/^second-value\|/);

      expect(printed()).not.toContain("first-value");
      expect(printed()).not.toContain("second-value");
    } finally {
      env.dispose();
      stderr.mockRestore();
    }
  });
});

describe("MCP servers whose failures repeat what they were sent", () => {
  const token = "token-value-never-shown";
  const team = "team-value-never-shown";
  const vault = { ECHO_TOKEN: token, TEAM: team };
  const headers = { Authorization: "Bearer ${ECHO_TOKEN}" };
  let dir: string;
  let httpServer: Server;
  let transport: NodeStreamableHTTPServerTransport;
  let base: string;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-echo-")));
    const mcp = new McpServer({ name: "echo-fixture", version: "1.0.0" });
    mcp.registerTool(
      "add",
      { description: "Adds two numbers.", inputSchema: z.object({ a: z.number(), b: z.number() }) },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    );
    transport = new NodeStreamableHTTPServerTransport();
    await mcp.connect(transport);
    // A refusal repeats the request line and its credentials, as a debugging proxy or a
    // careless framework does: `/refuse/…` refuses everything, `/mcp` only the tool calls.
    httpServer = createServer((req, res) => {
      const refuse = () => {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(`refused ${req.method} ${req.url} for ${req.headers.authorization}`);
      };
      if (req.url?.startsWith("/refuse/")) return refuse();
      if (req.method !== "POST") return void transport.handleRequest(req, res);
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as { method?: string };
        if (body.method === "tools/call") refuse();
        else void transport.handleRequest(req, res, body);
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await transport.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await rmEventually(dir);
  }, 30_000);

  /** Runs `body` with stderr captured; returns what was printed. */
  async function printedWhile(body: () => Promise<void>): Promise<string> {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await body();
      return stderr.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      stderr.mockRestore();
    }
  }

  it("reports a refused connect, and a stdio server's dying words, with the references in place of the vault values", async () => {
    const env = new Environment({
      workspaceDir: dir,
      toolConfig: {
        customTools: [],
        mcpServers: [
          { name: "refused", config: { url: `${base}/refuse/\${TEAM}`, headers } },
          {
            name: "dying",
            config: {
              command: process.execPath,
              args: [
                "-e",
                "process.stderr.write('started with ' + process.env.LEAK); setTimeout(() => process.exit(1), 50)",
              ],
              env: { LEAK: "${ECHO_TOKEN}" },
            },
          },
        ],
      },
      vault,
    });
    try {
      const printed = await printedWhile(async () => {
        expect(await env.listTools()).toEqual([]);
      });
      const [refused, dying] = env.mcpConnectResults();
      expect(refused).toMatchObject({ status: "fatal", error_code: "connect_failed" });
      expect(dying).toMatchObject({ status: "fatal", error_code: "connect_failed" });
      // Both did repeat what they were sent: the references stand where the values were.
      expect(refused!.error_message).toContain("/refuse/${TEAM} for Bearer ${ECHO_TOKEN}");
      expect(dying!.error_message).toContain("started with ${ECHO_TOKEN}");
      expect(printed).toContain("started with ${ECHO_TOKEN}");
      for (const text of [JSON.stringify(env.mcpConnectResults()), printed]) {
        expect(text).not.toContain(token);
        expect(text).not.toContain(team);
      }
    } finally {
      env.dispose();
    }
  });

  it("fails a call whose refusal repeats the request with the references in place of the vault values", async () => {
    const env = new Environment({
      workspaceDir: dir,
      toolConfig: {
        customTools: [],
        mcpServers: [{ name: "web", config: { url: `${base}/mcp?team=\${TEAM}`, headers } }],
      },
      vault,
    });
    try {
      expect((await env.listTools()).map((t) => t.name)).toEqual(["mcp__web__add"]);
      const final = finalPayload(await runTool(env, "mcp__web__add", { a: 2, b: 3 }));
      expect(final.stop_reason).toBe("fatal");
      expect(final.output).toContain("/mcp?team=${TEAM} for Bearer ${ECHO_TOKEN}");
      expect(final.output).not.toContain(token);
      expect(final.output).not.toContain(team);
    } finally {
      env.dispose();
    }
  });
});

describe("MCP over stdio through Environment", () => {
  let tmp: string;
  let env: Environment;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-")));
    env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()] },
      vault: { FIXTURE_SECRET: "from-vault" },
    });
  });

  afterAll(async () => {
    env.dispose();
    await rmEventually(tmp);
  }, 30_000);

  it("lists discovered tools under prefixed names with their schemas", async () => {
    const tools = await env.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "mcp__fx__echo",
      "mcp__fx__fail",
      "mcp__fx__pic",
      "mcp__fx__slow",
      "mcp__fx__probe",
      "mcp__fx__spam",
    ]);
    const echo = tools.find((t) => t.name === "mcp__fx__echo")!;
    expect(echo.description).toBe("Echoes back the input text.");
    const params = echo.parameters as { type?: string; properties?: Record<string, unknown> };
    expect(params.type).toBe("object");
    expect(Object.keys(params.properties ?? {})).toContain("text");
  });

  it("executes a call with Environment framing; streamed deltas equal the complete message", async () => {
    const messages = await runTool(env, "mcp__fx__echo", { text: "hi" });
    const first = messages[0]!.payload as { type?: string; event_type?: string };
    expect(first.type).toBe("partial_tool_call_output");
    expect(first.event_type).toBe("start");
    const final = finalPayload(messages);
    expect(final.type).toBe("tool_call_output");
    expect(final.stop_reason).toBe("completed");
    expect(final.output).toBe("echo: hi");
    expect(streamedText(messages)).toBe(final.output);
  });

  it("maps a tool-level isError result to failed with the server's message", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__fail", {}));
    expect(final.stop_reason).toBe("fatal");
    expect(final.output).toBe("boom");
  });

  it("carries image content as data-URL images alongside the text", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__pic", {}));
    expect(final.stop_reason).toBe("completed");
    expect(final.output).toBe("a tiny image");
    expect(final.images).toHaveLength(1);
    expect(final.images![0]).toMatch(/^data:image\/png;base64,/);
  });

  it("keeps the vault out of the server process and defaults cwd to the Workspace", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
    const [secret, cwd] = (final.output ?? "").split("|");
    // The Environment was built with a vault, but MCP server processes must not see it —
    // only the entry's own env reaches them (covered in the budgets block below).
    expect(secret).toBe("");
    // realpath'd on both sides; case-insensitive to stay stable on Windows drives.
    expect(cwd!.toLowerCase()).toBe(tmp.toLowerCase());
  });

  it("answers toolPermission from the server's readOnlyHint annotation", async () => {
    await env.listTools();
    expect(env.toolPermission("mcp__fx__echo")).toBe("r");
    expect(env.toolPermission("mcp__fx__fail")).toBe("rw");
    expect(env.toolPermission("mcp__fx__missing")).toBeUndefined();
  });

  it("collapses an unknown MCP name into the unknown-tool reply", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__nope", {}));
    expect(final.stop_reason).toBe("fatal");
    expect(final.output).toContain("Unknown tool: mcp__fx__nope");
  });
});

describe("MCP over stdio — under the Session's sandbox", () => {
  const RUNNER = fileURLToPath(new URL("./fixtures/mcp-runner.mjs", import.meta.url));
  let tmp: string;
  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-sandbox-")));
  });
  afterAll(async () => {
    await rmEventually(tmp);
  });

  it("starts a server through the Session's confiner, with the runner's environment laid over the server's", async () => {
    const scopes: unknown[] = [];
    const env = new Environment({
      workspaceDir: tmp,
      sessionScratchpadDir: path.join(tmp, "scratchpad", "s1"),
      toolConfig: {
        customTools: [],
        mcpServers: [fixtureEntry({ env: { FIXTURE_SECRET: "from-entry" } })],
      },
      confineSpawn: () => (argv, opts) => {
        scopes.push(opts);
        return {
          argv: [argv[0]!, RUNNER, ...argv.slice(1)],
          env: { FIXTURE_SECRET: "from-runner" },
        };
      },
    });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
      // The runner's entry lies over the entry's own, and the runner saw it first.
      expect(final.output).toMatch(/^via-runner:from-runner\|/);
      // The first spawn the confiner saw is the server's (the file tools' helper is asked
      // about at every tool call, after the server connected).
      expect(scopes[0]).toEqual({
        cwd: tmp,
        workspaceDir: tmp,
        scratchpadDir: path.join(tmp, "scratchpad", "s1"),
      });
    } finally {
      env.dispose();
    }
  });

  it("fails that server's connect when the confiner cannot enforce the policy, and starts nothing", async () => {
    const provider = new McpToolProvider([fixtureEntry()], {
      workspaceDir: tmp,
      confineSpawn: () => () => {
        throw new Error("no sandbox backend is mounted");
      },
      warn: () => {},
    });
    try {
      expect(await provider.listTools()).toEqual([]);
      const [result] = provider.connectResults();
      expect(result).toMatchObject({
        server: "fx",
        transport: "stdio",
        status: "fatal",
        error_code: "connect_failed",
      });
      expect(result!.error_message).toContain("sandbox: no sandbox backend is mounted");
    } finally {
      await provider.close();
    }
  });

  it("starts a server unconfined while the confiner getter answers null", async () => {
    const provider = new McpToolProvider([fixtureEntry()], {
      workspaceDir: tmp,
      confineSpawn: () => null,
      warn: () => {},
    });
    try {
      expect((await provider.listTools()).length).toBeGreaterThan(0);
    } finally {
      await provider.close();
    }
  });
});

describe("MCP over stdio — per-server budgets and interruption", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-b-")));
  });

  afterAll(async () => {
    await rmEventually(tmp);
  }, 30_000);

  function makeEnv(extra: Record<string, unknown>): Environment {
    return new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry(extra)] },
    });
  }

  it("applies the per-server maxOutputLength with the standard truncation marker", async () => {
    const env = makeEnv({ maxOutputLength: 100 });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__spam", {}));
      expect(final.stop_reason).toBe("completed");
      expect(final.output).toBe(
        `${"x".repeat(50)}\n[output truncated: kept first 50 and last 50 of 500 chars]\n${"x".repeat(50)}`,
      );
    } finally {
      env.dispose();
    }
  });

  it("applies the per-server timeoutMs and finalizes as failed", async () => {
    const env = makeEnv({ timeoutMs: 300 });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__slow", { ms: 60_000 }));
      expect(final.stop_reason).toBe("fatal");
      expect(final.output).toContain("[tool timeout: exceeded 300ms]");
    } finally {
      env.dispose();
    }
  });

  it("finalizes a user interruption as aborted", async () => {
    const env = makeEnv({});
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 150);
      const final = finalPayload(await runTool(env, "mcp__fx__slow", { ms: 60_000 }, ac.signal));
      expect(final.stop_reason).toBe("aborted");
      expect(final.output).toContain("[interrupted: tool aborted by user]");
    } finally {
      env.dispose();
    }
  });

  it("passes the entry's env variables to the server process", async () => {
    const env = makeEnv({ env: { FIXTURE_SECRET: "from-entry" } });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
      expect(final.output).toMatch(/^from-entry\|/);
    } finally {
      env.dispose();
    }
  });

  it("the host's harness variables never reach a stdio server", async () => {
    // The stdio child env is the MCP SDK's safe-inherited allowlist plus the entry's own
    // env — assembled in provider.ts, apart from the command-session strip — so the
    // serving process's PENGUIN_HOME/PORT must be invisible here even though no strip
    // runs on this path. Pinned locally because only the allowlist guarantees it: a
    // widened inherited base (say, spreading process.env) would leak silently otherwise.
    // The child env is captured when the server connects, i.e. at the first tool call of
    // this fresh Environment, so the pollution below is what that capture sees.
    const saved = { PENGUIN_HOME: process.env.PENGUIN_HOME, PORT: process.env.PORT };
    process.env.PENGUIN_HOME = "leak-check-root";
    process.env.PORT = "7364";
    const env = makeEnv({ env: { FIXTURE_SECRET: "still-arrives" } });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
      const [secret, , penguinHome, port] = (final.output ?? "").split("|");
      expect(secret).toBe("still-arrives");
      expect(penguinHome).toBe("");
      expect(port).toBe("");
    } finally {
      env.dispose();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("skips an unreachable server with a warning instead of failing", async () => {
    const warn = vi.fn();
    const provider = new McpToolProvider(
      [{ name: "broken", config: { command: "definitely-not-a-real-command-xyz" } }],
      { warn },
    );
    try {
      expect(await provider.listTools()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MCP server "broken" unavailable/));
    } finally {
      await provider.close();
    }
  });
});

describe("MCP over stdio — per-server permission override", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-p-")));
  });

  afterAll(async () => {
    await rmEventually(tmp);
  }, 30_000);

  function makeEnv(extra: Record<string, unknown>): Environment {
    return new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry(extra)] },
    });
  }

  // The fixture's "echo" advertises readOnlyHint: true and "fail" advertises no hint, so one
  // server exercises both directions of an explicit level contradicting the annotation.
  it('forces "rw" onto every tool, including one advertising readOnlyHint: true', async () => {
    const env = makeEnv({ permission: "rw" });
    try {
      await env.listTools();
      expect(env.toolPermission("mcp__fx__echo")).toBe("rw");
      expect(env.toolPermission("mcp__fx__fail")).toBe("rw");
    } finally {
      env.dispose();
    }
  });

  it('forces "r" onto every tool, including one advertising no hint', async () => {
    const env = makeEnv({ permission: "r" });
    try {
      await env.listTools();
      expect(env.toolPermission("mcp__fx__fail")).toBe("r");
      expect(env.toolPermission("mcp__fx__echo")).toBe("r");
    } finally {
      env.dispose();
    }
  });

  it('leaves the annotation in charge on an explicit "auto"', async () => {
    const env = makeEnv({ permission: "auto" });
    try {
      await env.listTools();
      expect(env.toolPermission("mcp__fx__echo")).toBe("r");
      expect(env.toolPermission("mcp__fx__fail")).toBe("rw");
    } finally {
      env.dispose();
    }
  });

  it("skips a server whose permission value is not a level, keeping the Agent up", async () => {
    const warn = vi.fn();
    const provider = new McpToolProvider([fixtureEntry({ permission: "readonly" })], { warn });
    try {
      expect(await provider.listTools()).toEqual([]);
      expect(provider.pendingServerNames()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/MCP server "fx" skipped: "permission" must be "auto", "r" or "rw"/),
      );
    } finally {
      await provider.close();
    }
  });
});

describe("Session first-run bootstrap events", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-s-")));
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const fakeLLM: LLMInterface = {
    async *streamGenerate(): AsyncGenerator<OmniMessage, LLMOutcome> {
      yield assistantText("done");
      return { status: "completed" };
    },
  };

  function makeSession(env: Environment, written: OmniMessage[]): Session {
    const meta: SessionMetaPayload = {
      session_id: "s-mcp",
      provider: "custom",
      model_id: "m",
      model_context_window: 1000,
      system_prompt: "sp",
      agent_state: tmp,
      workspace: tmp,
      source: "user",
    };
    return new Session({
      meta,
      // The real composition layer's opening procedure, spelled out: connect pair around
      // the pending connect, then the toolset record, all through emit.
      bootstrap: async ({ emit }) => {
        const pending = env.pendingMcpServerNames();
        if (pending.length > 0) emit(mcpConnectBegin(pending));
        const tools = await env.listTools();
        if (pending.length > 0) emit(mcpConnectEnd(mcpConnectOutcome(env.mcpConnectResults())));
        emit(toolListReady(tools));
        return { tools, llm: fakeLLM };
      },
      environment: env,
      trace: {
        write: async (msg) => {
          written.push(msg);
        },
      },
      imagesDir: path.join(tmp, "scratch"),
      modelHasVision: true,
    });
  }

  it("streams the connect pair and tool_list_ready before the first reply; the Trace puts them after the input", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [fixtureEntry()] },
    });
    const written: OmniMessage[] = [];
    const session = makeSession(env, written);
    try {
      const streamed: OmniMessage[] = [];
      for await (const msg of session.run([userText("go")])) streamed.push(msg);
      const types = streamed.map((m) => (m.payload as { type?: string }).type);
      expect(types.slice(0, 3)).toEqual([
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      expect(types).toContain("text");
      const begin = streamed[0]!.payload as { servers?: string[] };
      expect(begin.servers).toEqual(["fx"]);
      const end = streamed[1]!.payload as {
        status?: string;
        results?: { server: string; status: string; tools?: number; duration_ms: number }[];
      };
      expect(end.status).toBe("completed");
      expect(end.results).toHaveLength(1);
      expect(end.results![0]).toMatchObject({ server: "fx", status: "completed", tools: 6 });
      const toolsMsg = streamed[2]!.payload as { tools?: { name: string }[] };
      expect(toolsMsg.tools!.map((t) => t.name)).toContain("mcp__fx__echo");
      // Trace ordering: the engine writes the bootstrap records AFTER the run's input, so
      // the connect phase belongs to the new turn — meta, the user text, then the pair.
      const writtenTypes = written.map(
        (m) => (m.payload as { type?: string }).type ?? "session_meta",
      );
      expect(writtenTypes.slice(0, 5)).toEqual([
        "session_meta",
        "text",
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      // Second run: the bootstrap already happened — no repeated events.
      const second: OmniMessage[] = [];
      for await (const msg of session.run([userText("again")])) second.push(msg);
      const secondTypes = second.map((m) => (m.payload as { type?: string }).type);
      expect(secondTypes).not.toContain("mcp_connect_begin");
      expect(secondTypes).not.toContain("tool_list_ready");
    } finally {
      session.dispose();
    }
  });

  it("emits only tool_list_ready when no MCP servers are configured", async () => {
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [] },
    });
    const written: OmniMessage[] = [];
    const session = makeSession(env, written);
    try {
      const streamed: OmniMessage[] = [];
      for await (const msg of session.run([userText("go")])) streamed.push(msg);
      const types = streamed.map((m) => (m.payload as { type?: string }).type);
      expect(types[0]).toBe("tool_list_ready");
      expect(types).not.toContain("mcp_connect_begin");
    } finally {
      session.dispose();
    }
  });

  it("aborts mid-connect: cancels the attempt (live-only events) and the next run reconnects", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: { customTools: [], mcpServers: [] },
    });
    const written: OmniMessage[] = [];
    // Capturing LLM: the carry-over assertion below reads what the request delivered.
    const requests: OmniMessage[][] = [];
    const capturingLLM: LLMInterface = {
      async *streamGenerate(parameters): AsyncGenerator<OmniMessage, LLMOutcome> {
        requests.push(parameters.newMessages);
        yield assistantText("done");
        return { status: "completed" };
      },
    };
    const session = new Session({
      meta: {
        session_id: "s-mcp-abort",
        provider: "custom",
        model_id: "m",
        model_context_window: 1000,
        system_prompt: "sp",
        agent_state: tmp,
        workspace: tmp,
        source: "user",
      },
      bootstrap: async ({ emit }) => {
        calls += 1;
        emit(mcpConnectBegin(["fx"]));
        await gate;
        emit(mcpConnectEnd({ status: "completed", results: [] }));
        const tools = [{ name: "t", description: "d" }];
        emit(toolListReady(tools));
        return { tools, llm: capturingLLM };
      },
      environment: env,
      trace: {
        write: async (msg) => {
          written.push(msg);
        },
      },
      imagesDir: path.join(tmp, "scratch"),
      modelHasVision: true,
    });
    try {
      const ac = new AbortController();
      const first: OmniMessage[] = [];
      const run = (async () => {
        for await (const msg of session.run([userText("go")], { signal: ac.signal })) {
          first.push(msg);
        }
      })();
      // Wait for the begin event to stream, then interrupt mid-connect.
      for (let i = 0; i < 100 && first.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      ac.abort();
      await run;
      const firstTypes = first.map((m) => (m.payload as { type?: string }).type);
      expect(firstTypes).toEqual(["mcp_connect_begin", "mcp_connect_end", "abort"]);
      expect((first[1]!.payload as { status?: string }).status).toBe("aborted");
      // The aborted turn is RECORDED: the Session itself writes the input, the aborted
      // connect pair and the abort event (no engine exists to do it) — the analysis page
      // shows the interruption and a reload/restart keeps the message.
      const writtenTypes = written.map(
        (m) => (m.payload as { type?: string }).type ?? "session_meta",
      );
      expect(writtenTypes).toEqual([
        "session_meta",
        "text",
        "mcp_connect_begin",
        "mcp_connect_end",
        "abort",
      ]);
      expect((written.at(-2)!.payload as { status?: string }).status).toBe("aborted");

      release();
      const second: OmniMessage[] = [];
      for await (const msg of session.run([userText("again")])) second.push(msg);
      const secondTypes = second.map((m) => (m.payload as { type?: string }).type);
      expect(secondTypes.slice(0, 3)).toEqual([
        "mcp_connect_begin",
        "mcp_connect_end",
        "tool_list_ready",
      ]);
      expect((second[1]!.payload as { status?: string }).status).toBe("completed");
      expect(secondTypes).toContain("text");
      // Abort cancels the attempt: the next run started a FRESH bootstrap (reconnect).
      expect(calls).toBe(2);
      // The aborted run's input is carried into this run — persisted ahead of the new
      // input (dropping it would silently lose the user's message: nothing had reached
      // the Trace) and delivered to the model in the same order.
      const writtenUserTexts = written
        .filter((m) => m.type === "model_msg")
        .map((m) => (m.payload as { text?: string }).text)
        .filter((t): t is string => t === "go" || t === "again");
      expect(writtenUserTexts).toEqual(["go", "again"]);
      const requestTexts = (requests.at(-1) ?? [])
        .map((m) => (m.payload as { text?: string }).text)
        .filter((t): t is string => t === "go" || t === "again");
      expect(requestTexts).toEqual(["go", "again"]);
    } finally {
      session.dispose();
    }
  });

  it("cancelConnect aborts the in-flight attempt and the next listTools reconnects", async () => {
    const provider = new McpToolProvider([fixtureEntry()], { warn: () => {} });
    try {
      const first = provider.listTools();
      provider.cancelConnect();
      await expect(first).rejects.toThrow(/cancelled/);
      // Fresh attempt after the cancel: a full reconnect succeeds.
      const tools = await provider.listTools();
      expect(tools).toHaveLength(6);
      expect(provider.connectResults()[0]).toMatchObject({ server: "fx", status: "completed" });
    } finally {
      await provider.close();
    }
  });

  it("records per-server connect outcomes, including failures", async () => {
    const provider = new McpToolProvider(
      [
        fixtureEntry(),
        { name: "broken", config: { command: "definitely-not-a-real-command-xyz" } },
      ],
      { warn: () => {} },
    );
    try {
      await provider.listTools();
      const results = provider.connectResults();
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        server: "fx",
        transport: "stdio",
        status: "completed",
        tools: 6,
      });
      expect(results[1]).toMatchObject({
        server: "broken",
        transport: "stdio",
        status: "fatal",
        error_code: "connect_failed",
      });
      expect(results[1]!.error_message).toBeTruthy();
      expect(results[1]!.duration_ms).toBeGreaterThanOrEqual(0);
    } finally {
      await provider.close();
    }
  });

  it("skips tools whose prefixed name is unusable for LLM APIs, with a warning (count excludes them)", async () => {
    const warnings: string[] = [];
    const provider = new McpToolProvider([fixtureEntry()], { warn: (m) => warnings.push(m) });
    try {
      const tools = await provider.listTools();
      // The fixture's "dot.name" tool is listed by the server but never registered: one
      // unusable name in the schema list would 400 every request of the Session.
      expect(tools.map((t) => t.name)).not.toContain("mcp__fx__dot.name");
      expect(tools).toHaveLength(6);
      expect(provider.connectResults()[0]).toMatchObject({ status: "completed", tools: 6 });
      expect(warnings.some((w) => w.includes('"dot.name"') && w.includes("skipped"))).toBe(true);
    } finally {
      await provider.close();
    }
  });
});

describe("MCP over Streamable HTTP", () => {
  let httpServer: Server;
  let transport: NodeStreamableHTTPServerTransport;
  let url: string;
  const seenHeaders: IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    const mcp = new McpServer({ name: "http-fixture", version: "1.0.0" });
    mcp.registerTool(
      "add",
      { description: "Adds two numbers.", inputSchema: z.object({ a: z.number(), b: z.number() }) },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    );
    transport = new NodeStreamableHTTPServerTransport();
    await mcp.connect(transport);
    httpServer = createServer((req, res) => {
      seenHeaders.push(req.headers);
      void transport.handleRequest(req, res);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  });

  afterAll(async () => {
    await transport.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it("discovers and calls tools over http, sending the configured headers — vault references filled in — on every request", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "penguin-mcp-http-"));
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [
          {
            name: "web",
            config: { transport: "http", url, headers: { "x-penguin-test": "${WEB_HEADER}" } },
          },
        ],
      },
      vault: { WEB_HEADER: "yes" },
    });
    try {
      const tools = await env.listTools();
      expect(tools.map((t) => t.name)).toEqual(["mcp__web__add"]);
      const final = finalPayload(await runTool(env, "mcp__web__add", { a: 2, b: 3 }));
      expect(final.stop_reason).toBe("completed");
      expect(final.output).toBe("5");
      expect(seenHeaders.length).toBeGreaterThan(0);
      expect(seenHeaders.every((h) => h["x-penguin-test"] === "yes")).toBe(true);
    } finally {
      env.dispose();
      await rmEventually(tmp);
    }
  });
});
