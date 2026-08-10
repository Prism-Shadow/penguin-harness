import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import { Environment } from "../src/environment/index.js";
import { McpToolProvider, renderCallToolResult } from "../src/environment/mcp/provider.js";
import { toolCall } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { MCPServerConfig } from "../src/interfaces.js";

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
    await rm(tmp, { recursive: true, force: true });
  });

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
    expect(final.stop_reason).toBe("failed");
    expect(final.output).toBe("boom");
  });

  it("carries image content as data-URL images alongside the text", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__pic", {}));
    expect(final.stop_reason).toBe("completed");
    expect(final.output).toBe("a tiny image");
    expect(final.images).toHaveLength(1);
    expect(final.images![0]).toMatch(/^data:image\/png;base64,/);
  });

  it("injects vault variables into the server process and defaults cwd to the Workspace", async () => {
    const final = finalPayload(await runTool(env, "mcp__fx__probe", {}));
    const [secret, cwd] = (final.output ?? "").split("|");
    expect(secret).toBe("from-vault");
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
    expect(final.stop_reason).toBe("failed");
    expect(final.output).toContain("Unknown tool: mcp__fx__nope");
  });
});

describe("MCP over stdio — per-server budgets and interruption", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-mcp-b-")));
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

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
      expect(final.output).toBe("x".repeat(100) + "\n[output truncated: exceeded 100 chars]");
    } finally {
      env.dispose();
    }
  });

  it("applies the per-server timeoutMs and finalizes as failed", async () => {
    const env = makeEnv({ timeoutMs: 300 });
    try {
      const final = finalPayload(await runTool(env, "mcp__fx__slow", { ms: 60_000 }));
      expect(final.stop_reason).toBe("failed");
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

  it("discovers and calls tools over http, sending the configured headers on every request", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "penguin-mcp-http-"));
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: {
        customTools: [],
        mcpServers: [
          { name: "web", config: { transport: "http", url, headers: { "x-penguin-test": "yes" } } },
        ],
      },
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
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
